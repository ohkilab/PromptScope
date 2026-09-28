import {
  AXIS_MINIMUM, PASS_SCORE, PENALTY_SPECS, RUBRIC_VERSION, rubricFor,
  rubricForCustom, type CriterionId, type RubricScenarioId,
} from "./rubric.ts";
import type { EvaluationProfile } from "./exercises.ts";

export type AnalysisStep = { id: string; title: string; instruction: string; context: string };
export type EvaluationCriterionId = CriterionId;
export type EvaluationProvider = "ollama" | "openrouter" | "rules";
export type CheckStatus = "missing" | "partial" | "met";
export type Evidence = { stepId: string; field: "instruction" | "context"; quote: string };
export type EvaluationCheck = {
  id: string; label: string; criterion: CriterionId; required: boolean;
  status: CheckStatus; score: number; max: number; reason: string; evidence: Evidence[];
};
export type EvaluationCriterion = {
  id: CriterionId; label: string; score: number; max: number; message: string;
  checks: EvaluationCheck[];
};
export type EvaluationPenalty = {
  id: string; label: string; points: number; reason: string; evidence: Evidence[];
};
export type EvaluationResult = {
  criteria: EvaluationCriterion[];
  strengths: string[];
  improvements: string[];
  earned: number;
  deduction: number;
  penalties: EvaluationPenalty[];
  scoreCap: number;
  capReasons: string[];
  requiredMissing: string[];
  passed: boolean;
  total: number;
  provider: EvaluationProvider;
  model: string;
  rubricVersion: string;
};
export type EvaluationRequest = (
  | { scenarioId: RubricScenarioId; scenario?: never }
  | { scenarioId?: never; scenario: {
      title: string; description: string; goal: string; environment: string;
      materials: string; evaluationProfile: EvaluationProfile;
    } }
) & { steps: AnalysisStep[] };

export function rubricForRequest(request: EvaluationRequest) {
  return request.scenario ? rubricForCustom(request.scenario.evaluationProfile) : rubricFor(request.scenarioId!);
}

export const CRITERION_SPECS = [
  { id: "granularity", label: "分割粒度", max: 20 },
  { id: "context", label: "コンテキスト充足", max: 20 },
  { id: "safety", label: "安全性・権限境界", max: 20 },
  { id: "verifiability", label: "検証可能性", max: 20 },
  { id: "artifact", label: "成果物の明確さ", max: 20 },
] as const;

const REASON_PROPERTY = { type: "string", minLength: 1, maxLength: 240 } as const;
const EVIDENCE_PROPERTY = {
  type: "array", maxItems: 80,
  items: { type: "string", minLength: 1, maxLength: 40 },
} as const;

/** Stable, server-issued references preserve verbatim evidence without model transcription. */
export function evidenceSources(steps: AnalysisStep[]): (Evidence & { sourceId: string })[] {
  return steps.flatMap((step, stepIndex) => (["instruction", "context"] as const).flatMap((field) => {
    const parts = step[field].match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [];
    const chunks = parts.flatMap((part) => {
      const result: string[] = [];
      // Keep every excerpt contiguous in the original text, including long paragraphs.
      for (let offset = 0; offset < part.length; offset += 400) {
        const quote = part.slice(offset, offset + 400).trim();
        if (quote) result.push(quote);
      }
      return result;
    });
    return chunks.map((quote, index) => ({
      sourceId: `s${stepIndex + 1}-${field === "instruction" ? "i" : "c"}${index + 1}`,
      stepId: step.id, field, quote,
    }));
  }));
}

/** The model supplies classifications and evidence, never scores or pass/fail. */
export const EVALUATION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    relevance: {
      type: "object", additionalProperties: false,
      properties: {
        evidence: EVIDENCE_PROPERTY, reason: REASON_PROPERTY,
        status: { type: "string", enum: ["relevant", "partial", "irrelevant"] },
      },
      required: ["status", "reason", "evidence"],
    },
    checks: {
      type: "array", minItems: 15, maxItems: 15,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string", enum: rubricFor("tutorial").map((item) => item.id) },
          evidence: EVIDENCE_PROPERTY,
          missingElements: { type: "array", maxItems: 8, items: REASON_PROPERTY },
          reason: REASON_PROPERTY,
          status: { type: "string", enum: ["missing", "partial", "met"] },
        },
        required: ["id", "evidence", "missingElements", "reason", "status"],
      },
    },
    violations: {
      type: "array", minItems: PENALTY_SPECS.length, maxItems: PENALTY_SPECS.length,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string", enum: PENALTY_SPECS.map((item) => item.id) },
          evidence: EVIDENCE_PROPERTY, reason: REASON_PROPERTY, present: { type: "boolean" },
        },
        required: ["id", "present", "reason", "evidence"],
      },
    },
  },
  required: ["relevance", "checks", "violations"],
} as const;

type UnknownRecord = Record<string, unknown>;
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredString(value: unknown, field: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`LLM response has an invalid ${field}.`);
  }
  return value.trim();
}
function indexedItems(value: unknown, ids: readonly string[], field: string): Map<string, UnknownRecord> {
  if (!Array.isArray(value) || value.length !== ids.length) {
    throw new Error(`LLM response has an invalid ${field} count.`);
  }
  const entries = new Map<string, UnknownRecord>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !ids.includes(item.id) || entries.has(item.id)) {
      throw new Error(`LLM response has an unknown or duplicate ${field} id.`);
    }
    entries.set(item.id, item);
  }
  return entries;
}
function evidenceFor(value: unknown, steps: AnalysisStep[]): { evidence: Evidence[]; invalid: boolean } {
  if (!Array.isArray(value) || value.length > 80) throw new Error("Invalid evidence array.");
  const sources = new Map(evidenceSources(steps).map((item) => [item.sourceId, item]));
  const evidence: Evidence[] = [];
  let invalid = false;
  for (const sourceId of value) {
    if (typeof sourceId !== "string" || !sourceId || sourceId.length > 40) throw new Error("Invalid evidence reference.");
    const source = sources.get(sourceId);
    if (!source) { invalid = true; continue; }
    const item: Evidence = { stepId: source.stepId, field: source.field, quote: source.quote };
    if (!evidence.some((entry) => evidenceKey(entry) === evidenceKey(item))) evidence.push(item);
  }
  return { evidence, invalid };
}

function evidenceKey(item: Evidence): string {
  return JSON.stringify([item.stepId, item.field, item.quote]);
}
function duplicateTasks(steps: AnalysisStep[]): Evidence[] {
  const seen = new Map<string, AnalysisStep>();
  const duplicates: Evidence[] = [];
  for (const step of steps) {
    const text = [step.instruction, step.context].join("\n").normalize("NFKC").replace(/\s+/g, "");
    if (!text) continue;
    const earlier = seen.get(text);
    if (earlier) {
      for (const item of [earlier, step]) {
        const field = item.instruction.trim() ? "instruction" : "context";
        duplicates.push({ stepId: item.id, field, quote: item[field].trim().slice(0, 400) });
      }
    } else seen.set(text, step);
  }
  return duplicates.filter((item, index, list) => list.findIndex((entry) => evidenceKey(entry) === evidenceKey(item)) === index);
}

/** Empty input can be evaluated without a model or credentials. */
export function emptyEvaluation(request: EvaluationRequest): EvaluationResult {
  return normalizeEvaluation({
    relevance: { status: "irrelevant", reason: "指示とコンテキストを入力してください。", evidence: [] },
    checks: rubricForRequest(request).map((item) => ({ id: item.id, status: "missing", missingElements: [item.label], reason: item.description.slice(0, 240), evidence: [] })),
    violations: PENALTY_SPECS.map((item) => ({ id: item.id, present: false, reason: "該当する記述なし。", evidence: [] })),
  }, request, "rules", "入力チェック");
}

/** Evidence validation, fixed scoring, caps and completion decisions are server-owned. */
export function normalizeEvaluation(
  value: unknown, request: EvaluationRequest, provider: EvaluationProvider, model: string,
): EvaluationResult {
  if (!isRecord(value) || !isRecord(value.relevance)) throw new Error("Invalid evaluation object.");
  const { steps } = request;
  const rubric = rubricForRequest(request);
  const rawChecks = indexedItems(value.checks, rubric.map((item) => item.id), "checks");
  const rawViolations = indexedItems(value.violations, PENALTY_SPECS.map((item) => item.id), "violations");
  const relevance = value.relevance.status;
  if (!["relevant", "partial", "irrelevant"].includes(String(relevance))) throw new Error("Invalid relevance.");
  const relevanceReason = requiredString(value.relevance.reason, "relevance reason");
  const relevanceEvidence = evidenceFor(value.relevance.evidence, steps);
  const noAnswer = steps.length === 0 || steps.every((step) => !step.instruction.trim() && !step.context.trim());
  const unrelated = noAnswer || relevance === "irrelevant" || !relevanceEvidence.evidence.length || relevanceEvidence.invalid;
  const checks: EvaluationCheck[] = rubric.map((spec) => {
    const raw = rawChecks.get(spec.id)!;
    if (raw.status !== "missing" && raw.status !== "partial" && raw.status !== "met") throw new Error("Invalid check status.");
    let status: CheckStatus = raw.status;
    let reason = requiredString(raw.reason, `${spec.id} reason`);
    if (!Array.isArray(raw.missingElements) || raw.missingElements.length > 8) throw new Error("Missing element analysis is required.");
    const missingElements = raw.missingElements.map((item) => requiredString(item, "missing element"));
    if (status === "met" && missingElements.length) status = "partial";
    if (missingElements.length) reason = `${missingElements.join("・")}が不足。${reason}`.slice(0, 240);
    const verified = evidenceFor(raw.evidence, steps);
    if (unrelated || (status !== "missing" && (!verified.evidence.length || verified.invalid))) {
      status = "missing";
      reason = unrelated ? "課題に対応する作業指示を確認できません。" : "加点の根拠となる引用を回答本文で確認できません。";
    }
    if (status === "met" && spec.allSteps) {
      const uncovered = steps.filter((step) => !verified.evidence.some((item) => item.stepId === step.id));
      if (uncovered.length) {
        status = "partial";
        reason = `タスク${uncovered.map((step) => steps.indexOf(step) + 1).join("・")}の根拠がありません。すべてのタスクで具体化してください。`;
      }
    }
    return {
      id: spec.id, criterion: spec.criterion, label: spec.label, required: spec.required,
      max: spec.max, score: status === "met" ? spec.max : status === "partial" ? spec.max / 4 : 0,
      status, reason, evidence: verified.evidence,
    };
  });

  let scoreCap = 100;
  const capReasons: string[] = [];
  function cap(max: number, reason: string) {
    scoreCap = Math.min(scoreCap, max);
    capReasons.push(`${reason}（上限${max}点）`);
  }
  if (unrelated) cap(0, noAnswer ? "回答本文が空です" : "課題に対応する作業指示の根拠がありません");
  else if (relevance === "partial") cap(29, "課題との対応が部分的で、具体的な計画になっていません");
  const requiredMissing = checks.filter((item) => item.required && item.status !== "met").map((item) => item.label);
  if (checks.some((item) => item.required && item.status === "missing")) cap(59, "必須項目に未充足があります");
  else if (requiredMissing.length) cap(79, "必須項目に抽象的・部分的な記述が残っています");
  const emptySteps = steps.filter((step) => !step.instruction.trim() && !step.context.trim());
  if (emptySteps.length && !noAnswer) cap(49, "本文が空のタスクが残っています");

  const penalties: EvaluationPenalty[] = [];
  for (const spec of PENALTY_SPECS) {
    const raw = rawViolations.get(spec.id)!;
    if (typeof raw.present !== "boolean") throw new Error("Invalid violation flag.");
    const reason = requiredString(raw.reason, `${spec.id} reason`);
    const verified = evidenceFor(raw.evidence, steps);
    if (!raw.present) continue;
    if (verified.invalid || !verified.evidence.length || (spec.id === "contradiction" && verified.evidence.length < 2)) {
      throw new Error(`Unverifiable ${spec.id} violation.`);
    }
    // A prohibited instruction is deducted once, even if also classified as contradictory.
    const unsafeEvidence = penalties.find((item) => item.id === "unsafe")?.evidence ?? [];
    if (spec.id === "contradiction" && verified.evidence.some((item) => unsafeEvidence.some((entry) => entry.stepId === item.stepId && entry.field === item.field &&
      (entry.quote.includes(item.quote) || item.quote.includes(entry.quote))))) continue;
    penalties.push({ id: spec.id, label: spec.label, points: spec.points, reason, evidence: verified.evidence });
    if (spec.cap < 100) cap(spec.cap, spec.label);
  }
  const duplicates = duplicateTasks(steps);
  if (duplicates.length && !penalties.some((item) => item.id === "padding")) {
    penalties.push({ id: "padding", label: "重複・無関係な水増し", points: 5, reason: "本文が同一のタスクがあります。独立した役割がなければ統合してください。", evidence: duplicates });
  }
  const criteria: EvaluationCriterion[] = CRITERION_SPECS.map((spec) => {
    const items = checks.filter((item) => item.criterion === spec.id);
    const missing = items.filter((item) => item.status !== "met");
    return {
      ...spec, score: items.reduce((sum, item) => sum + item.score, 0), checks: items,
      message: missing.length ? `${missing.map((item) => item.label).join("・")}を具体化してください。` : "すべての項目で具体的な根拠を確認しました。",
    };
  });
  if (criteria.some((item) => item.score < AXIS_MINIMUM)) cap(79, "12点未満の評価軸があります");
  const earned = criteria.reduce((sum, item) => sum + item.score, 0);
  const deduction = penalties.reduce((sum, item) => sum + item.points, 0);
  const total = Math.max(0, Math.min(scoreCap, earned - deduction));
  return {
    criteria, earned, deduction, penalties, scoreCap, capReasons, requiredMissing, total,
    passed: total >= PASS_SCORE && !requiredMissing.length && criteria.every((item) => item.score >= AXIS_MINIMUM),
    strengths: checks.filter((item) => item.status === "met").slice(0, 4).map((item) => `${item.label}：${item.reason}`),
    improvements: [
      ...(unrelated || relevance === "partial" ? [relevanceReason] : []),
      ...penalties.map((item) => `${item.label}：${item.reason}`),
      ...checks.filter((item) => item.status !== "met").sort((a, b) => Number(b.required) - Number(a.required))
        .map((item) => `${item.required ? "【必須】" : ""}${item.label}：${item.reason}`),
    ],
    provider, model, rubricVersion: RUBRIC_VERSION,
  };
}

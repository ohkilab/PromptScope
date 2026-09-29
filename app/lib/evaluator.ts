import type { EvaluationProfile } from "./exercises";
import {
  AXIS_MINIMUM,
  DEFAULT_SPECIFIC_CRITERIA,
  PASS_SCORE,
  RUBRIC_VERSION,
  SCENARIO_SPECIFIC_CRITERIA,
  STATUS_LABELS,
  STEP_AXIS_MINIMUM,
  STEP_SCORED_CRITERIA,
  UNSAFE_CAP,
  planItems,
  rubricFor,
  rubricTypeFor,
  statusPoints,
  stepItems,
  type ChecklistEntry,
  type CriterionId,
  type RubricItem,
  type RubricScenarioId,
  type RubricStatus,
  type RubricTypeId,
  type TaskTypeRubric,
} from "./rubric";

/** A single analysis task authored in the trainer. */
export type AnalysisStep = {
  id: string;
  title: string;
  instruction: string;
  context: string;
};

export type EvaluationCriterionId = CriterionId;

export type EvaluationStepDetail = {
  stepId: string;
  stepNumber: number;
  title: string;
  score: number;
  max: number;
  message: string;
  subcriteria?: EvaluationSubcriterion[];
};

export type EvaluationSubcriterion = {
  id: string;
  label: string;
  score: number;
  max: number;
  message: string;
  status?: RubricStatus;
  evidence?: string;
};

export type EvaluationFinding = {
  code: string;
  label: string;
  points: number;
  stepReferences: string[];
  evidence: string;
  guidance: string;
};

export type EvaluationCriterion = {
  id: EvaluationCriterionId;
  label: string;
  score: number;
  max: number;
  message: string;
  subcriteria?: EvaluationSubcriterion[];
  stepDetails?: EvaluationStepDetail[];
  findings?: EvaluationFinding[];
};

export type EvaluationProvider = "ollama" | "openrouter";

export type EvaluationDeduction = {
  id: "unsafe";
  label: string;
  cap: number;
  evidence: string[];
  stepReferences: string[];
  reason: string;
};

export type EvaluationTaskRole = {
  stepId: string;
  stepNumber: number;
  phase: string | null;
  redundant: boolean;
};

export type EvaluationResult = {
  criteria: EvaluationCriterion[];
  deductions: EvaluationDeduction[];
  taskRoles: EvaluationTaskRole[];
  strengths: string[];
  improvements: string[];
  total: number;
  passed: boolean;
  gateFailures: string[];
  provider: EvaluationProvider;
  model: string;
  rubricType: RubricTypeId;
  rubricVersion: string;
};

export type EvaluationRequest = {
  scenario: {
    rubricScenarioId: RubricScenarioId;
    title: string;
    description: string;
    goal: string;
    environment: string;
    materials?: string;
    evaluationProfile?: EvaluationProfile;
  };
  steps: AnalysisStep[];
};

export const CRITERION_SPECS = [
  { id: "granularity", label: "分割粒度", max: 20 },
  { id: "context", label: "コンテキスト充足", max: 20 },
  { id: "safety", label: "安全性・権限境界", max: 20 },
  { id: "verifiability", label: "検証可能性", max: 20 },
  { id: "artifact", label: "成果物の明確さ", max: 20 },
] as const;

export const PASSING_TOTAL = PASS_SCORE;
export const MINIMUM_STEP_SCORE = STEP_AXIS_MINIMUM;

const REASON_MAX_LENGTH = 80;

// ---------------------------------------------------------------------------
// Rubric resolution
// ---------------------------------------------------------------------------

/** One judgement the LLM returns. Checklist items expand to one entry per phase/premise. */
export type RubricEntry = {
  key: string;
  item: RubricItem;
  checklist?: ChecklistEntry;
  label: string;
  description: string;
};

export type ResolvedRubric = {
  typeId: RubricTypeId;
  definition: TaskTypeRubric;
  phases: ChecklistEntry[];
  premises: ChecklistEntry[];
  specificCriteria: Record<CriterionId, string>;
  planEntries: RubricEntry[];
  stepEntries: RubricEntry[];
};

export function resolveRubric(request: EvaluationRequest): ResolvedRubric {
  const { rubricScenarioId, evaluationProfile } = request.scenario;
  const typeId = rubricTypeFor(rubricScenarioId, evaluationProfile?.domain);
  const definition = rubricFor(typeId);
  const customPhases = typeId === "other" ? evaluationProfile?.phases ?? [] : [];
  const phases = customPhases.length > 0
    ? customPhases.map((label, index) => ({ id: `phase-${index + 1}`, label }))
    : definition.phases;
  const premises = definition.premises;
  const specificCriteria = Object.fromEntries(CRITERION_SPECS.map(({ id }) => {
    const scenarioText = rubricScenarioId === "malware" || rubricScenarioId === "vulnerability" || rubricScenarioId === "logs"
      ? SCENARIO_SPECIFIC_CRITERIA[rubricScenarioId][id]
      : rubricScenarioId === "custom" ? evaluationProfile?.focus[id]?.trim() : undefined;
    return [id, scenarioText || DEFAULT_SPECIFIC_CRITERIA[typeId][id]];
  })) as Record<CriterionId, string>;

  const planEntries = planItems(definition).flatMap((item): RubricEntry[] => {
    if (item.kind === "checklist") {
      const entries = item.id === "coverage" ? phases : premises;
      return entries.map((entry) => ({
        key: `${item.id}:${entry.id}`,
        item,
        checklist: entry,
        label: `${item.label}：${entry.label}`,
        description: item.id === "coverage"
          ? `工程「${entry.label}」を、具体的な作業指示として計画のいずれかのタスクが含むか。`
          : `前提「${entry.label}」を、計画のいずれかのタスクで具体的に渡しているか。`,
      }));
    }
    return [{
      key: item.id,
      item,
      label: item.label,
      description: item.kind === "specific"
        ? `この問題で特に確認する観点：${specificCriteria[item.criterion]}`
        : item.description,
    }];
  });
  const stepEntries = stepItems(definition).map((item) => ({
    key: item.id,
    item,
    label: item.label,
    description: item.description,
  }));
  return { typeId, definition, phases, premises, specificCriteria, planEntries, stepEntries };
}

// ---------------------------------------------------------------------------
// Deterministic text checks
// ---------------------------------------------------------------------------

export type StepTextIssues = {
  stepId: string;
  /** 指示とコンテキストがどちらも空欄・プレースホルダー・無意味な文字列。 */
  empty: boolean;
  noiseFragments: string[];
  identifierIssues: string[];
};

const NOISE_FRAGMENT_PATTERNS = [
  /([^\s\p{P}\p{S}\p{N}])\1{3,}/gu,
  /(\p{L}{2,3})\1{2,}/gu,
  /(?<![A-Za-z])(?:asdf|qwer|zxcv|hjkl|uiop)[a-z]*/giu,
];
const PLACEHOLDER_PATTERN = /^(todo|tbd|n\/a|none|null|placeholder|未定|仮|テスト|ダミー|なし|あとで|後で)[.!。…]*$/u;
const PREVIOUS_STEP_REFERENCE = /前段|前のタスク|前タスク|前の(?:結果|成果物|工程|出力)|前工程/u;
const STEP_NUMBER_REFERENCE = /(?:タスク|ステップ)\s*(\d{1,2})/gu;
const FILENAME_PATTERN = /[A-Za-z0-9_-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b/g;

function noiseFragments(value: string): string[] {
  const fragments = new Set<string>();
  const text = value.normalize("NFKC");
  for (const pattern of NOISE_FRAGMENT_PATTERNS) {
    for (const match of text.matchAll(pattern)) fragments.add(match[0]);
  }
  return [...fragments];
}

export function isClearlyNonInstructional(value: string): boolean {
  let compact = value.normalize("NFKC");
  for (const fragment of noiseFragments(compact)) compact = compact.split(fragment).join("");
  compact = compact.replace(/[\s\p{P}\p{S}_]+/gu, "").toLowerCase();
  return !compact || PLACEHOLDER_PATTERN.test(compact);
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
}

export function analyzeStepText(request: EvaluationRequest): StepTextIssues[] {
  const { scenario, steps } = request;
  const knownFiles = new Set([scenario.description, scenario.goal, scenario.environment, scenario.materials ?? ""]
    .flatMap((text) => text.match(FILENAME_PATTERN) ?? [])
    .map((name) => name.toLowerCase()));
  return steps.map((step, index) => {
    const text = `${step.title}\n${step.instruction}\n${step.context}`;
    const identifierIssues: string[] = [];
    if (index === 0 && PREVIOUS_STEP_REFERENCE.test(`${step.instruction}\n${step.context}`)) {
      identifierIssues.push("先頭のタスクが、存在しない前段の成果物を参照しています。");
    }
    for (const match of text.matchAll(STEP_NUMBER_REFERENCE)) {
      const number = Number(match[1]);
      if (number < 1 || number > steps.length) {
        identifierIssues.push(`存在しない「${match[0]}」を参照しています（タスクは${steps.length}件）。`);
      }
    }
    for (const name of new Set(text.match(FILENAME_PATTERN) ?? [])) {
      const lower = name.toLowerCase();
      if (knownFiles.has(lower) || lower.length < 5) continue;
      const similar = [...knownFiles].find((known) => {
        const distance = editDistance(lower, known);
        return distance > 0 && distance <= 2;
      });
      if (similar) identifierIssues.push(`「${name}」は資料の「${similar}」の誤記の可能性があります。`);
    }
    return {
      stepId: step.id,
      empty: isClearlyNonInstructional(step.instruction) && isClearlyNonInstructional(step.context),
      noiseFragments: noiseFragments(`${step.instruction}\n${step.context}`).slice(0, 5),
      identifierIssues: [...new Set(identifierIssues)].slice(0, 5),
    };
  });
}

// ---------------------------------------------------------------------------
// LLM output schemas
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function sentenceOptions(texts: string[]): string[] {
  return [...new Set(texts.flatMap((text) =>
    (text.match(/[^。！？．\n]+[。！？．]?/gu) ?? []).map((part) => part.trim()).filter(Boolean)))];
}

function resultsSchema(entries: RubricEntry[], evidence: string[]) {
  const common = {
    key: { type: "string", enum: entries.map((entry) => entry.key) },
    reason: { type: "string", maxLength: REASON_MAX_LENGTH },
  };
  const variant = (statuses: RubricStatus[], evidenceOptions: string[]) => ({
    type: "object",
    additionalProperties: false,
    properties: {
      key: common.key,
      status: { type: "string", enum: statuses },
      evidence: { type: "string", enum: evidenceOptions },
      reason: common.reason,
    },
    required: ["key", "status", "evidence", "reason"],
  });
  // 小さいモデルは根拠を空にしがちなため、missing以外では根拠の選択をSchemaで必須にする。
  return {
    type: "array",
    minItems: entries.length,
    maxItems: entries.length,
    items: evidence.length > 0
      ? { anyOf: [variant(["met", "mostly", "partial"], evidence), variant(["missing"], [""])] }
      : variant(["missing"], [""]),
  };
}

export function stepEvaluationSchema(rubric: ResolvedRubric, step: AnalysisStep) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      results: resultsSchema(rubric.stepEntries, sentenceOptions([step.title, step.instruction, step.context])),
    },
    required: ["results"],
  };
}

export function planEvaluationSchema(rubric: ResolvedRubric, request: EvaluationRequest) {
  const stepIds = request.steps.map((step) => step.id);
  const evidence = sentenceOptions(request.steps.flatMap((step) => [step.title, step.instruction, step.context]));
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      results: resultsSchema(rubric.planEntries, evidence),
      taskRoles: {
        type: "array",
        minItems: stepIds.length,
        maxItems: stepIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            stepId: { type: "string", enum: stepIds },
            phase: { type: "string", enum: [...rubric.phases.map((phase) => phase.id), "none"] },
            redundant: { type: "boolean" },
          },
          required: ["stepId", "phase", "redundant"],
        },
      },
      unsafe: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            stepId: { type: "string", enum: stepIds },
            evidence: { type: "string", enum: evidence.length > 0 ? evidence : [""] },
            reason: { type: "string", maxLength: REASON_MAX_LENGTH },
          },
          required: ["stepId", "evidence", "reason"],
        },
      },
      strengths: { type: "array", maxItems: 3, items: { type: "string", maxLength: REASON_MAX_LENGTH } },
    },
    required: ["results", "taskRoles", "unsafe", "strengths"],
  };
}

// ---------------------------------------------------------------------------
// Validation of each LLM call
// ---------------------------------------------------------------------------

export type ValidatedResult = {
  entry: RubricEntry;
  status: RubricStatus;
  evidence: string;
  reason: string;
};

export type ValidatedPlanEvaluation = {
  results: ValidatedResult[];
  taskRoles: Array<{ stepId: string; phase: string | null; redundant: boolean }>;
  unsafe: Array<{ stepId: string; evidence: string; reason: string }>;
  strengths: string[];
};

const STATUS_ORDER: RubricStatus[] = ["missing", "partial", "mostly", "met"];

function capStatus(status: RubricStatus, cap: RubricStatus): RubricStatus {
  return STATUS_ORDER.indexOf(status) > STATUS_ORDER.indexOf(cap) ? cap : status;
}

function shortReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, REASON_MAX_LENGTH) : "";
}

function validateResults(value: unknown, entries: RubricEntry[], sources: string[], scope: string): ValidatedResult[] {
  if (!Array.isArray(value)) throw new Error(`LLM response is missing ${scope} results.`);
  const byKey = new Map<string, UnknownRecord>();
  for (const raw of value) {
    if (isRecord(raw) && typeof raw.key === "string" && !byKey.has(raw.key)) byKey.set(raw.key, raw);
  }
  const normalizedSources = sources.map(normalizedText);
  return entries.map((entry) => {
    const raw = byKey.get(entry.key);
    if (!raw) throw new Error(`LLM response is missing ${scope} result for ${entry.key}.`);
    const status = raw.status;
    if (typeof status !== "string" || !(status in STATUS_LABELS)) {
      throw new Error(`LLM response has an invalid status for ${scope} ${entry.key}.`);
    }
    const evidence = typeof raw.evidence === "string" ? raw.evidence.trim() : "";
    if (status !== "missing") {
      if (!evidence) throw new Error(`LLM response is missing evidence for ${scope} ${entry.key}.`);
      if (!normalizedSources.some((source) => source.includes(normalizedText(evidence)))) {
        throw new Error(`LLM response has evidence not found in ${scope} for ${entry.key}.`);
      }
    }
    return {
      entry,
      status: status as RubricStatus,
      evidence: status === "missing" ? "" : evidence,
      reason: shortReason(raw.reason),
    };
  });
}

/** Validates the per-task call and applies the deterministic caps for that task. */
export function validateStepEvaluation(
  value: unknown,
  request: EvaluationRequest,
  rubric: ResolvedRubric,
  stepId: string,
  issues: StepTextIssues,
): ValidatedResult[] {
  const step = request.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Unknown step ${stepId}.`);
  if (!isRecord(value)) throw new Error("LLM response is not a valid step evaluation object.");
  const results = validateResults(value.results, rubric.stepEntries, [step.title, step.instruction, step.context], `task ${stepId}`);
  return results.map((result) => {
    if (issues.empty) {
      return { ...result, status: "missing", evidence: "", reason: "指示とコンテキストが空欄・プレースホルダー・無意味な文字列です。" };
    }
    if (result.entry.item.kind !== "accuracy") return result;
    if (issues.identifierIssues.length > 0) {
      return { ...result, status: "missing", evidence: "", reason: issues.identifierIssues[0] };
    }
    if (issues.noiseFragments.length > 0) {
      const status = capStatus(result.status, "partial");
      return status === result.status ? result : {
        ...result,
        status,
        reason: `意味のない文字列「${issues.noiseFragments[0]}」が含まれています。`,
      };
    }
    return result;
  });
}

const NEGATED_ENDING = /(?:しない|しません|しないこと|しないでください|禁止(?:する|します|です|とする)?|せず|行わない|避ける|不可|厳禁)[。．.!！]?\s*$/u;

export function validatePlanEvaluation(
  value: unknown,
  request: EvaluationRequest,
  rubric: ResolvedRubric,
  issues: StepTextIssues[],
): ValidatedPlanEvaluation {
  if (!isRecord(value)) throw new Error("LLM response is not a valid plan evaluation object.");
  const sources = request.steps.flatMap((step) => [step.title, step.instruction, step.context]);
  const allEmpty = issues.every((issue) => issue.empty);
  const results = validateResults(value.results, rubric.planEntries, sources, "plan").map((result) => allEmpty
    ? { ...result, status: "missing" as const, evidence: "", reason: "すべてのタスクが空欄・プレースホルダー・無意味な文字列です。" }
    : result);

  if (!Array.isArray(value.taskRoles)) throw new Error("LLM response is missing taskRoles.");
  const phaseIds = new Set(rubric.phases.map((phase) => phase.id));
  const roles = new Map<string, { phase: string | null; redundant: boolean }>();
  for (const raw of value.taskRoles) {
    if (!isRecord(raw) || typeof raw.stepId !== "string" || roles.has(raw.stepId)) continue;
    if (!request.steps.some((step) => step.id === raw.stepId)) throw new Error(`LLM response has an invalid stepId ${String(raw.stepId)} in taskRoles.`);
    roles.set(raw.stepId, {
      phase: typeof raw.phase === "string" && phaseIds.has(raw.phase) ? raw.phase : null,
      redundant: raw.redundant === true,
    });
  }
  const taskRoles = request.steps.map((step, index) => {
    const role = roles.get(step.id);
    if (!role) throw new Error(`LLM response is missing taskRoles for ${step.id}.`);
    return issues[index].empty ? { stepId: step.id, phase: null, redundant: false } : { stepId: step.id, ...role };
  });

  const unsafe: ValidatedPlanEvaluation["unsafe"] = [];
  for (const raw of Array.isArray(value.unsafe) ? value.unsafe : []) {
    if (!isRecord(raw) || typeof raw.stepId !== "string" || typeof raw.evidence !== "string") continue;
    const step = request.steps.find((item) => item.id === raw.stepId);
    if (!step) throw new Error(`LLM response has an invalid stepId ${raw.stepId} in unsafe.`);
    const evidence = raw.evidence.trim();
    if (!evidence) continue;
    const found = [step.title, step.instruction, step.context]
      .some((source) => normalizedText(source).includes(normalizedText(evidence)));
    if (!found) throw new Error(`LLM response has unsafe evidence not found in task ${raw.stepId}.`);
    // 禁止・否定で終わる文は禁止操作の指示ではないため、小さいモデルの誤検出として除外する。
    if (NEGATED_ENDING.test(evidence)) continue;
    if (unsafe.some((item) => item.stepId === raw.stepId && item.evidence === evidence)) continue;
    unsafe.push({ stepId: raw.stepId, evidence, reason: shortReason(raw.reason) || "禁止操作を実行させる指示です。" });
  }

  const strengths = Array.isArray(value.strengths)
    ? value.strengths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 3).map((item) => item.trim().slice(0, REASON_MAX_LENGTH))
    : [];
  return { results, taskRoles, unsafe, strengths };
}

// ---------------------------------------------------------------------------
// Scoring（点数はすべて整数。端数は切り捨て）
// ---------------------------------------------------------------------------

function statusFromScore(score: number, max: number): RubricStatus {
  if (score >= max) return "met";
  if (score >= statusPoints(max, "mostly")) return "mostly";
  if (score > 0) return "partial";
  return "missing";
}

/** 平均を切り捨てて整数にする。 */
function flooredAverage(points: number[]): number {
  return Math.floor(points.reduce((sum, point) => sum + point, 0) / points.length);
}

function stepReference(request: EvaluationRequest, stepId: string): string {
  const index = request.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return "";
  const title = request.steps[index].title.trim();
  return `タスク${index + 1}${title ? `「${title}」` : ""}`;
}

function clippedEvidence(value: string): string {
  const text = normalizedText(value);
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

function fallbackReason(result: ValidatedResult): string {
  return result.reason || result.entry.description.slice(0, 120);
}

type ImprovementCandidate = { priority: number; message: string };

export function scoreEvaluation(
  request: EvaluationRequest,
  rubric: ResolvedRubric,
  stepResults: ValidatedResult[][],
  plan: ValidatedPlanEvaluation,
  provider: EvaluationProvider,
  model: string,
): EvaluationResult {
  if (stepResults.length !== request.steps.length) throw new Error("Step results do not match the number of steps.");
  const paddingSteps = plan.taskRoles.filter((role) => role.phase === null || role.redundant);
  const stepFailures: string[] = [];
  const coreFailures: string[] = [];
  const improvements: ImprovementCandidate[] = [];

  const criteria = CRITERION_SPECS.map((spec): EvaluationCriterion => {
    const items = rubric.definition.items.filter((item) => item.criterion === spec.id);
    const findings: EvaluationFinding[] = [];

    const subcriteria = items.map((item): EvaluationSubcriterion => {
      if (item.scope === "step") {
        const perStep = stepResults.map((results) => results.find((result) => result.entry.item.id === item.id)!);
        const score = flooredAverage(perStep.map((result) => statusPoints(item.max, result.status)));
        const weak = perStep
          .map((result, index) => ({ result, index }))
          .filter(({ result }) => result.status !== "met");
        for (const { result, index } of weak) {
          if (item.core && result.status === "missing") {
            coreFailures.push(`中核項目「${item.label}」がタスク${index + 1}で未充足です。`);
          }
        }
        if (weak.length > 0) {
          const lost = item.max - score;
          const first = weak[0];
          findings.push({
            code: item.id,
            label: item.label,
            points: lost,
            stepReferences: weak.map(({ result, index }) => `${stepReference(request, request.steps[index].id)}：${STATUS_LABELS[result.status]}`),
            evidence: "",
            guidance: fallbackReason(first.result),
          });
          improvements.push({
            priority: lost,
            message: `${item.label}（${weak.map(({ index }) => `タスク${index + 1}`).join("・")}）：${fallbackReason(first.result)}`,
          });
        }
        return {
          id: item.id,
          label: item.label,
          score,
          max: item.max,
          status: statusFromScore(score, item.max),
          evidence: perStep.map((result) => result.evidence).filter(Boolean).slice(0, 2).map(clippedEvidence).join(" / "),
          message: weak.length > 0
            ? fallbackReason(weak[0].result)
            : `${perStep.length > 1 ? `${perStep.length}タスクすべてで` : ""}満たしています。`,
        };
      }

      const results = plan.results.filter((result) => result.entry.item.id === item.id);
      const beforePadding = flooredAverage(results.map((result) => statusPoints(item.max, result.status)));
      const weak = results.filter((result) => result.status !== "met");
      for (const result of weak) {
        if (item.core && result.status === "missing") coreFailures.push(`中核項目「${result.entry.label}」が未充足です。`);
      }
      if (weak.length > 0) {
        const lost = item.max - beforePadding;
        const guidance = item.kind === "checklist"
          ? `${weak.map((result) => `${result.entry.checklist?.label}（${STATUS_LABELS[result.status]}）`).join("、")}。${fallbackReason(weak[0])}`
          : fallbackReason(weak[0]);
        findings.push({ code: item.id, label: item.label, points: lost, stepReferences: [], evidence: "", guidance });
        improvements.push({ priority: lost, message: `${item.label}：${guidance}` });
      }

      let score = beforePadding;
      let message = weak.length > 0 ? fallbackReason(weak[0]) : "具体的に満たしています。";
      if (item.id === "coverage" && paddingSteps.length > 0) {
        score = Math.max(0, beforePadding - paddingSteps.length);
        const references = paddingSteps.map((role) => stepReference(request, role.stepId));
        const guidance = "どの工程にも当たらない、または他のタスクと役割が重なるタスクがあります。役割を明確にするか統合してください。";
        findings.push({ code: "padding", label: "不要・重複タスク", points: beforePadding - score, stepReferences: references, evidence: "", guidance });
        improvements.push({
          priority: beforePadding - score,
          message: `不要・重複タスク（${references.map((reference) => reference.replace(/「.*$/u, "")).join("・")}）：${guidance}`,
        });
        if (weak.length === 0) message = guidance;
      }
      return {
        id: item.id,
        label: item.label,
        score,
        max: item.max,
        status: statusFromScore(score, item.max),
        evidence: results.map((result) => result.evidence).filter(Boolean).slice(0, 2).map(clippedEvidence).join(" / "),
        message,
      };
    });

    const stepScoped = items.filter((item) => item.scope === "step");
    const stepMax = stepScoped.reduce((sum, item) => sum + item.max, 0);
    const scaleToAxis = (STEP_SCORED_CRITERIA as readonly CriterionId[]).includes(spec.id);
    const stepDetails = stepScoped.length === 0 ? [] : request.steps.map((step, index): EvaluationStepDetail => {
      const results = stepResults[index].filter((result) => result.entry.item.criterion === spec.id);
      const raw = results.reduce((sum, result) => sum + statusPoints(result.entry.item.max, result.status), 0);
      const score = scaleToAxis ? Math.floor(raw * spec.max / stepMax) : raw;
      const max = scaleToAxis ? spec.max : stepMax;
      if (scaleToAxis && score < STEP_AXIS_MINIMUM) {
        stepFailures.push(`タスク${index + 1}の${spec.label}が${STEP_AXIS_MINIMUM}点未満です（${score}/${spec.max}）。`);
      }
      const weakest = results.find((result) => result.status !== "met");
      return {
        stepId: step.id,
        stepNumber: index + 1,
        title: step.title.trim() || `分析タスク ${index + 1}`,
        score,
        max,
        message: weakest ? fallbackReason(weakest) : "このタスクの項目を満たしています。",
        subcriteria: results.map((result) => ({
          id: result.entry.item.id,
          label: result.entry.item.label,
          score: statusPoints(result.entry.item.max, result.status),
          max: result.entry.item.max,
          status: result.status,
          evidence: result.evidence,
          message: result.status === "met" ? "満たしています。" : fallbackReason(result),
        })),
      };
    });

    const score = subcriteria.reduce((sum, item) => sum + item.score, 0);
    return {
      id: spec.id,
      label: spec.label,
      score,
      max: spec.max,
      message: `${subcriteria.map((item) => `${item.label}${item.score}/${item.max}`).join("、")}。`,
      subcriteria,
      ...(stepDetails.length > 0 ? { stepDetails } : {}),
      ...(findings.length > 0 ? { findings } : {}),
    };
  });

  const deductions: EvaluationDeduction[] = plan.unsafe.length === 0 ? [] : [{
    id: "unsafe",
    label: "禁止操作・権限逸脱",
    cap: UNSAFE_CAP,
    evidence: plan.unsafe.map((item) => clippedEvidence(item.evidence)),
    stepReferences: [...new Set(plan.unsafe.map((item) => stepReference(request, item.stepId)))],
    reason: plan.unsafe[0].reason,
  }];

  const baseTotal = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  const total = Math.min(baseTotal, deductions.length > 0 ? UNSAFE_CAP : 100);
  const gateFailures: string[] = [];
  if (total < PASS_SCORE) gateFailures.push(`総合点が合格基準の${PASS_SCORE}点に達していません。`);
  if (deductions.length > 0) gateFailures.push(`禁止操作を実行させる指示があるため、総合点は最大${UNSAFE_CAP}点です。`);
  gateFailures.push(...new Set(coreFailures));
  for (const criterion of criteria) {
    if (criterion.score < AXIS_MINIMUM) gateFailures.push(`${criterion.label}は${AXIS_MINIMUM}点以上が必要です。`);
  }
  gateFailures.push(...stepFailures);

  const prioritized = [
    ...deductions.map((deduction) => ({ priority: 1000, message: `${deduction.label}（上限${deduction.cap}点）：${deduction.evidence.join(" / ")}` })),
    ...improvements,
  ];
  const improvementMessages = [...new Map(prioritized
    .sort((left, right) => right.priority - left.priority)
    .map((item) => [item.message, item])).values()]
    .slice(0, 3)
    .map((item) => item.message.slice(0, 220));
  const strengths = plan.strengths.length > 0
    ? plan.strengths
    : criteria.flatMap((criterion) => criterion.subcriteria ?? [])
      .filter((item) => item.status === "met")
      .slice(0, 3)
      .map((item) => `${item.label}を具体的に記載しています。`);

  return {
    criteria,
    deductions,
    taskRoles: plan.taskRoles.map((role) => ({
      ...role,
      stepNumber: request.steps.findIndex((step) => step.id === role.stepId) + 1,
      phase: role.phase ? rubric.phases.find((phase) => phase.id === role.phase)?.label ?? null : null,
    })),
    strengths,
    improvements: improvementMessages,
    total,
    passed: gateFailures.length === 0,
    gateFailures,
    provider,
    model,
    rubricType: rubric.typeId,
    rubricVersion: RUBRIC_VERSION,
  };
}

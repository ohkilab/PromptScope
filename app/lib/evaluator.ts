/** A single analysis task authored in the trainer. */
export type AnalysisStep = {
  id: string;
  title: string;
  instruction: string;
  context: string;
};

export type EvaluationCriterionId =
  | "granularity"
  | "context"
  | "safety"
  | "verifiability"
  | "artifact";

export type EvaluationStepDetail = {
  stepId: string;
  stepNumber: number;
  title: string;
  score: number;
  max: number;
  message: string;
};

export type EvaluationCriterion = {
  id: EvaluationCriterionId;
  label: string;
  score: number;
  max: number;
  message: string;
  stepDetails?: EvaluationStepDetail[];
};

export type EvaluationProvider = "ollama" | "openrouter";

export type EvaluationResult = {
  criteria: EvaluationCriterion[];
  strengths: string[];
  improvements: string[];
  total: number;
  passed: boolean;
  gateFailures: string[];
  provider: EvaluationProvider;
  model: string;
};

export type EvaluationRequest = {
  scenario: {
    title: string;
    description: string;
    goal: string;
    environment: string;
  };
  steps: AnalysisStep[];
};

export const SAFETY_CHECK_IDS = [
  "authorized_scope",
  "least_privilege",
  "secret_protection",
  "change_and_network_boundary",
  "stop_and_recovery",
] as const;

export type SafetyCheckId = (typeof SAFETY_CHECK_IDS)[number];

export const SAFETY_VIOLATION_POINTS = {
  privilege_escalation: 6,
  secret_content_access: 8,
  secret_unprotected_output: 10,
  unauthorized_target_access: 8,
  destructive_or_evasive_action: 10,
  evidence_tampering: 10,
  forced_continuation: 6,
} as const;

export type SafetyViolationCode = keyof typeof SAFETY_VIOLATION_POINTS;

export const ARTIFACT_DEFECT_POINTS = {
  no_final_artifact: 10,
  goal_mismatch: 10,
  missing_required_content: 2,
  missing_evidence_traceability: 3,
  missing_handoff: 2,
  missing_acceptance_condition: 2,
  missing_audience: 1,
  missing_format: 1,
  missing_destination: 1,
} as const;

export type ArtifactDefectCode = keyof typeof ARTIFACT_DEFECT_POINTS;

export const CRITERION_SPECS = [
  { id: "granularity", label: "分割粒度", max: 20 },
  { id: "context", label: "コンテキスト充足", max: 20 },
  { id: "safety", label: "安全性・権限境界", max: 20 },
  { id: "verifiability", label: "検証可能性", max: 20 },
  { id: "artifact", label: "成果物の明確さ", max: 20 },
] as const;

export const PASSING_TOTAL = 80;
export const MINIMUM_STEP_SCORE = 12;

const CRITERION_IDS = CRITERION_SPECS.map((criterion) => criterion.id);

const SCORE_PROPERTY = {
  type: "integer",
  minimum: 0,
  maximum: 20,
} as const;

const MESSAGE_PROPERTY = {
  type: "string",
  minLength: 1,
  maxLength: 240,
} as const;

const DEDUCTION_PROPERTY = {
  type: "object",
  additionalProperties: false,
  properties: {
    code: { type: "string" },
    points: {
      type: "integer",
      minimum: 1,
      maximum: 20,
      description: "この1件のcodeに対応する固定減点値。複数件の合計値を書かない。",
    },
    stepIds: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 160 },
    },
    evidence: {
      type: "string",
      minLength: 1,
      maxLength: 400,
      description: "入力から改変せずに複写した短い部分文字列。説明文や引用符を加えない。",
    },
    message: MESSAGE_PROPERTY,
  },
  required: ["code", "points", "stepIds", "evidence", "message"],
} as const;

/** Shared by Ollama `format` and OpenRouter `response_format.json_schema`. */
export const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    criteria: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", enum: CRITERION_IDS },
          score: SCORE_PROPERTY,
          message: MESSAGE_PROPERTY,
        },
        required: ["id", "score", "message"],
      },
    },
    stepEvaluations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stepId: { type: "string", minLength: 1, maxLength: 160 },
          stepNumber: { type: "integer", minimum: 1 },
          title: { type: "string", minLength: 1, maxLength: 240 },
          granularity: {
            type: "object",
            additionalProperties: false,
            properties: {
              score: SCORE_PROPERTY,
              message: MESSAGE_PROPERTY,
            },
            required: ["score", "message"],
          },
          context: {
            type: "object",
            additionalProperties: false,
            properties: {
              score: SCORE_PROPERTY,
              message: MESSAGE_PROPERTY,
            },
            required: ["score", "message"],
          },
        },
        required: ["stepId", "stepNumber", "title", "granularity", "context"],
      },
    },
    safetyAssessment: {
      type: "object",
      additionalProperties: false,
      properties: {
        checks: {
          type: "array",
          minItems: 5,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", enum: SAFETY_CHECK_IDS },
              status: { type: "string", enum: ["met", "missing", "not_applicable"] },
              reason: MESSAGE_PROPERTY,
            },
            required: ["id", "status", "reason"],
          },
        },
        violations: {
          type: "array",
          maxItems: 7,
          items: {
            ...DEDUCTION_PROPERTY,
            properties: {
              ...DEDUCTION_PROPERTY.properties,
              code: { type: "string", enum: Object.keys(SAFETY_VIOLATION_POINTS) },
            },
          },
        },
        summary: MESSAGE_PROPERTY,
      },
      required: ["checks", "violations", "summary"],
    },
    artifactAssessment: {
      type: "object",
      additionalProperties: false,
      properties: {
        expectedArtifact: {
          type: "object",
          additionalProperties: false,
          properties: {
            purpose: MESSAGE_PROPERTY,
            requiredContents: {
              type: "array",
              maxItems: 8,
              items: MESSAGE_PROPERTY,
            },
            audience: { type: "string", maxLength: 240 },
            format: { type: "string", maxLength: 240 },
            destination: { type: "string", maxLength: 240 },
          },
          required: ["purpose", "requiredContents", "audience", "format", "destination"],
        },
        actualArtifact: MESSAGE_PROPERTY,
        defects: {
          type: "array",
          maxItems: 12,
          items: {
            ...DEDUCTION_PROPERTY,
            properties: {
              ...DEDUCTION_PROPERTY.properties,
              code: { type: "string", enum: Object.keys(ARTIFACT_DEFECT_POINTS) },
            },
          },
        },
        summary: MESSAGE_PROPERTY,
      },
      required: ["expectedArtifact", "actualArtifact", "defects", "summary"],
    },
    strengths: {
      type: "array",
      maxItems: 4,
      items: MESSAGE_PROPERTY,
    },
    improvements: {
      type: "array",
      maxItems: 6,
      items: MESSAGE_PROPERTY,
    },
  },
  required: [
    "criteria",
    "stepEvaluations",
    "safetyAssessment",
    "artifactAssessment",
    "strengths",
    "improvements",
  ],
} as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`LLM response is missing ${field}.`);
  }
  return value.trim().slice(0, 240);
}

function boundedScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`LLM response has an invalid ${field}.`);
  }
  return Math.max(0, Math.min(20, Math.round(value)));
}

function stringList(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`LLM response is missing ${field}.`);
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, limit)
    .map((item) => item.trim().slice(0, 240));
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function evaluationInputText(request: EvaluationRequest): string {
  return normalizedText([
    request.scenario.title,
    request.scenario.description,
    request.scenario.goal,
    request.scenario.environment,
    ...request.steps.flatMap((step) => [step.title, step.instruction, step.context]),
  ].join("\n"));
}

function validatedDeduction(
  value: unknown,
  field: string,
  request: EvaluationRequest,
  allowedPoints: Readonly<Record<string, number>>,
): { code: string; points: number; stepIds: string[]; message: string } {
  if (!isRecord(value)
    || typeof value.code !== "string"
    || !Object.prototype.hasOwnProperty.call(allowedPoints, value.code)) {
    throw new Error(`LLM response has an invalid ${field} code.`);
  }
  const expectedPoints = allowedPoints[value.code];
  if (value.points !== expectedPoints) {
    throw new Error(
      `LLM response has invalid points for ${field} ${value.code}: ${JSON.stringify(value.points)}.`,
    );
  }
  if (!Array.isArray(value.stepIds) || value.stepIds.length === 0) {
    throw new Error(`LLM response is missing ${field} stepIds.`);
  }
  const validStepIds = new Set(request.steps.map((step) => step.id));
  const stepIds = [...new Set(value.stepIds.map((stepId) => {
    if (typeof stepId !== "string" || !validStepIds.has(stepId)) {
      throw new Error(`LLM response has an invalid ${field} stepId.`);
    }
    return stepId;
  }))];
  const evidence = requiredString(value.evidence, `${field} evidence`);
  const normalizedInput = evaluationInputText(request);
  const evidenceCandidates = [
    evidence,
    ...[...evidence.matchAll(/[「『\"“]([^」』\"”]{1,400})[」』\"”]/g)]
      .map((match) => match[1]),
  ];
  if (!evidenceCandidates.some((candidate) => normalizedInput.includes(normalizedText(candidate)))) {
    throw new Error(
      `LLM response has evidence not found in the input for ${field}: ${JSON.stringify(evidence)}.`,
    );
  }
  return {
    code: value.code,
    points: expectedPoints,
    stepIds,
    message: requiredString(value.message, `${field} message`),
  };
}

const SAFETY_CHECK_COVERED_BY_VIOLATION: Readonly<Record<SafetyViolationCode, SafetyCheckId[]>> = {
  privilege_escalation: ["least_privilege"],
  secret_content_access: ["secret_protection"],
  secret_unprotected_output: ["secret_protection"],
  unauthorized_target_access: ["authorized_scope", "change_and_network_boundary"],
  destructive_or_evasive_action: ["change_and_network_boundary"],
  evidence_tampering: ["change_and_network_boundary"],
  forced_continuation: ["stop_and_recovery"],
};

function safetyEvaluation(
  value: unknown,
  request: EvaluationRequest,
): { score: number; message: string; violationCodes: SafetyViolationCode[] } {
  if (!isRecord(value) || !Array.isArray(value.checks) || !Array.isArray(value.violations)) {
    throw new Error("LLM response is missing safetyAssessment.");
  }

  const checks = new Map<SafetyCheckId, "met" | "missing" | "not_applicable">();
  for (const rawCheck of value.checks) {
    if (!isRecord(rawCheck) || !SAFETY_CHECK_IDS.includes(rawCheck.id as SafetyCheckId)) {
      throw new Error("LLM response has an invalid safety check.");
    }
    const id = rawCheck.id as SafetyCheckId;
    if (checks.has(id)) throw new Error(`LLM response has duplicate safety check ${id}.`);
    if (rawCheck.status !== "met" && rawCheck.status !== "missing" && rawCheck.status !== "not_applicable") {
      throw new Error(`LLM response has an invalid status for safety check ${id}.`);
    }
    requiredString(rawCheck.reason, `safety check ${id} reason`);
    checks.set(id, rawCheck.status);
  }
  if (checks.size !== SAFETY_CHECK_IDS.length) {
    throw new Error("LLM response does not contain all required safety checks.");
  }

  const violationMap = new Map<SafetyViolationCode, ReturnType<typeof validatedDeduction>>();
  for (const rawViolation of value.violations) {
    const violation = validatedDeduction(
      rawViolation,
      "safety violation",
      request,
      SAFETY_VIOLATION_POINTS,
    );
    const code = violation.code as SafetyViolationCode;
    const existing = violationMap.get(code);
    if (existing) {
      existing.stepIds = [...new Set([...existing.stepIds, ...violation.stepIds])];
    } else {
      violationMap.set(code, violation);
    }
  }

  const coveredChecks = new Set(
    [...violationMap.keys()].flatMap((code) => SAFETY_CHECK_COVERED_BY_VIOLATION[code]),
  );
  const missingChecks = SAFETY_CHECK_IDS.filter(
    (id) => checks.get(id) === "missing" && !coveredChecks.has(id),
  );
  const violationPoints = [...violationMap.values()].reduce(
    (sum, violation) => sum + violation.points,
    0,
  );
  const deduction = missingChecks.length * 2 + violationPoints;
  requiredString(value.summary, "safetyAssessment summary");
  const violationMessages = [...violationMap.values()].map((violation) => violation.message);
  const message = deduction === 0
    ? "減点なし。必須安全チェックを満たし、明示的な安全違反はありません。"
    : `${deduction}点減点（安全要件の不足${missingChecks.length}件、明示的違反${violationMap.size}件）。${violationMessages.slice(0, 2).join(" ")}`;
  return {
    score: Math.max(0, 20 - deduction),
    message: message.slice(0, 240),
    violationCodes: [...violationMap.keys()],
  };
}

function artifactEvaluation(
  value: unknown,
  request: EvaluationRequest,
): { score: number; message: string; defectCodes: ArtifactDefectCode[] } {
  if (!isRecord(value) || !isRecord(value.expectedArtifact) || !Array.isArray(value.defects)) {
    throw new Error("LLM response is missing artifactAssessment.");
  }
  requiredString(value.expectedArtifact.purpose, "expectedArtifact purpose");
  stringList(value.expectedArtifact.requiredContents, "expectedArtifact requiredContents", 8);
  if (typeof value.expectedArtifact.audience !== "string"
    || typeof value.expectedArtifact.format !== "string"
    || typeof value.expectedArtifact.destination !== "string") {
    throw new Error("LLM response has an invalid expectedArtifact contract.");
  }
  requiredString(value.actualArtifact, "actualArtifact");

  const expectedContract = {
    missing_audience: value.expectedArtifact.audience.trim(),
    missing_format: value.expectedArtifact.format.trim(),
    missing_destination: value.expectedArtifact.destination.trim(),
  } as const;
  const planText = normalizedText(request.steps.flatMap(
    (step) => [step.title, step.instruction, step.context],
  ).join("\n"));

  const uniqueDefects = new Map<ArtifactDefectCode, ReturnType<typeof validatedDeduction>>();
  const missingContents: ReturnType<typeof validatedDeduction>[] = [];
  for (const rawDefect of value.defects) {
    const defect = validatedDeduction(rawDefect, "artifact defect", request, ARTIFACT_DEFECT_POINTS);
    const code = defect.code as ArtifactDefectCode;
    if (code === "missing_required_content") {
      if (missingContents.length < 3) missingContents.push(defect);
    } else if (code === "missing_audience"
      || code === "missing_format"
      || code === "missing_destination") {
      const expectedValue = normalizedText(expectedContract[code]);
      if (expectedValue && !planText.includes(expectedValue) && !uniqueDefects.has(code)) {
        uniqueDefects.set(code, defect);
      }
    } else if (!uniqueDefects.has(code)) {
      uniqueDefects.set(code, defect);
    }
  }

  const noFinalArtifact = uniqueDefects.has("no_final_artifact");
  if (request.steps.length === 1) {
    uniqueDefects.delete("missing_handoff");
  }
  if (noFinalArtifact) {
    missingContents.length = 0;
    for (const code of ["missing_audience", "missing_format", "missing_destination"] as const) {
      uniqueDefects.delete(code);
    }
  }
  const deduction = [...uniqueDefects.values(), ...missingContents].reduce(
    (sum, defect) => sum + defect.points,
    0,
  );
  requiredString(value.summary, "artifactAssessment summary");
  const defectCount = uniqueDefects.size + missingContents.length;
  const defectMessages = [...uniqueDefects.values(), ...missingContents]
    .map((defect) => defect.message);
  const message = deduction === 0
    ? "減点なし。目標と最終成果物の整合性を確認しました。"
    : `${deduction}点減点（成果物の問題${defectCount}件）。${defectMessages.slice(0, 2).join(" ")}`;
  return {
    score: Math.max(0, 20 - deduction),
    message: message.slice(0, 240),
    defectCodes: [
      ...uniqueDefects.keys(),
      ...missingContents.map(() => "missing_required_content" as const),
    ],
  };
}

function stepDetailsFor(
  rawSteps: unknown,
  sourceSteps: AnalysisStep[],
  criterion: "granularity" | "context",
): EvaluationStepDetail[] {
  if (!Array.isArray(rawSteps)) {
    throw new Error("LLM response is missing stepEvaluations.");
  }

  return sourceSteps.map((sourceStep, index) => {
    const byId = rawSteps.find(
      (item) => isRecord(item) && item.stepId === sourceStep.id,
    );
    const byNumber = rawSteps.find(
      (item) => isRecord(item) && item.stepNumber === index + 1,
    );
    const rawStep = byId ?? byNumber;
    if (!isRecord(rawStep) || !isRecord(rawStep[criterion])) {
      throw new Error(`LLM response is missing task ${index + 1} ${criterion} details.`);
    }

    const rawDetail = rawStep[criterion] as UnknownRecord;
    return {
      stepId: sourceStep.id,
      stepNumber: index + 1,
      title: sourceStep.title.trim() || `分析タスク ${index + 1}`,
      score: boundedScore(rawDetail.score, `task ${index + 1} ${criterion} score`),
      max: 20,
      message: requiredString(rawDetail.message, `task ${index + 1} ${criterion} message`),
    };
  });
}

/**
 * Validate and normalize a model response. This function does not score text;
 * semantic evaluation is performed exclusively by the configured LLM.
 */
export function normalizeEvaluation(
  value: unknown,
  request: EvaluationRequest,
  provider: EvaluationProvider,
  model: string,
): EvaluationResult {
  if (!isRecord(value) || !Array.isArray(value.criteria)) {
    throw new Error("LLM response is not a valid evaluation object.");
  }

  const safety = safetyEvaluation(value.safetyAssessment, request);
  const artifact = artifactEvaluation(value.artifactAssessment, request);
  const rawCriteria = value.criteria.filter(isRecord);
  const criteria = CRITERION_SPECS.map((spec) => {
    const rawCriterion = rawCriteria.find((criterion) => criterion.id === spec.id);
    if (!rawCriterion) {
      throw new Error(`LLM response is missing criterion ${spec.id}.`);
    }

    const criterion: EvaluationCriterion = {
      id: spec.id,
      label: spec.label,
      score: boundedScore(rawCriterion.score, `${spec.id} score`),
      max: spec.max,
      message: requiredString(rawCriterion.message, `${spec.id} message`),
    };

    if (spec.id === "granularity" || spec.id === "context") {
      criterion.stepDetails = stepDetailsFor(value.stepEvaluations, request.steps, spec.id);
      criterion.score = Math.round(
        criterion.stepDetails.reduce((sum, detail) => sum + detail.score, 0) /
          Math.max(criterion.stepDetails.length, 1),
      );
    } else if (spec.id === "safety") {
      criterion.score = safety.score;
      criterion.message = safety.message;
    } else if (spec.id === "artifact") {
      criterion.score = artifact.score;
      criterion.message = artifact.message;
    }
    return criterion;
  });

  const total = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  const gateFailures: string[] = [];
  if (total < PASSING_TOTAL) {
    gateFailures.push(`総合点が合格基準の${PASSING_TOTAL}点に達していません。`);
  }

  for (const criterion of criteria) {
    if (!criterion.stepDetails) continue;
    for (const detail of criterion.stepDetails) {
      if (detail.score < MINIMUM_STEP_SCORE) {
        gateFailures.push(
          `タスク${detail.stepNumber}の${criterion.label}は${MINIMUM_STEP_SCORE}点以上が必要です。`,
        );
      }
    }
  }

  if (safety.score < 16) {
    gateFailures.push("安全性・権限境界は16点以上が必要です。");
  }
  if (safety.violationCodes.length > 0) {
    gateFailures.push("明示的な安全違反があるため合格できません。");
  }
  if (artifact.score < 12) {
    gateFailures.push("成果物の明確さは12点以上が必要です。");
  }
  if (artifact.defectCodes.includes("no_final_artifact")) {
    gateFailures.push("最終成果物が指定されていないため合格できません。");
  }
  if (artifact.defectCodes.includes("goal_mismatch")) {
    gateFailures.push("最終成果物が演習目的と一致しないため合格できません。");
  }

  return {
    criteria,
    strengths: stringList(value.strengths, "strengths", 4),
    improvements: stringList(value.improvements, "improvements", 6),
    total,
    passed: gateFailures.length === 0,
    gateFailures,
    provider,
    model,
  };
}

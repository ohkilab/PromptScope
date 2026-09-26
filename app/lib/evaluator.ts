import type { EvaluationProfile } from "./exercises";

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
  provider: EvaluationProvider;
  model: string;
};

export type EvaluationRequest = {
  scenario: {
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
  required: ["criteria", "stepEvaluations", "strengths", "improvements"],
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
  steps: AnalysisStep[],
  provider: EvaluationProvider,
  model: string,
): EvaluationResult {
  if (!isRecord(value) || !Array.isArray(value.criteria)) {
    throw new Error("LLM response is not a valid evaluation object.");
  }

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
      criterion.stepDetails = stepDetailsFor(value.stepEvaluations, steps, spec.id);
      criterion.score = Math.round(
        criterion.stepDetails.reduce((sum, detail) => sum + detail.score, 0) /
          Math.max(criterion.stepDetails.length, 1),
      );
    }
    return criterion;
  });

  return {
    criteria,
    strengths: stringList(value.strengths, "strengths", 4),
    improvements: stringList(value.improvements, "improvements", 6),
    total: criteria.reduce((sum, criterion) => sum + criterion.score, 0),
    provider,
    model,
  };
}

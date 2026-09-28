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
  stepDetails?: EvaluationStepDetail[];
  findings?: EvaluationFinding[];
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
    materials?: string;
    evaluationProfile?: EvaluationProfile;
  };
  steps: AnalysisStep[];
};

export const SAFETY_VIOLATION_POINTS = {
  privilege_escalation: 6,
  secret_content_access: 8,
  secret_unprotected_output: 10,
  unauthorized_target_access: 8,
  destructive_or_evasive_action: 10,
} as const;

export type SafetyViolationCode = keyof typeof SAFETY_VIOLATION_POINTS;

export const ARTIFACT_DEFECT_POINTS = {
  no_final_artifact: 10,
  goal_mismatch: 10,
  missing_required_content: 2,
  missing_handoff: 2,
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

const OBVIOUS_NOISE_DEDUCTION_PER_FRAGMENT = 2;
const MAX_OBVIOUS_NOISE_FRAGMENTS = 3;
const MAX_SCORE_WITH_OBVIOUS_TYPO = MINIMUM_STEP_SCORE - 1;

const LLM_SCORED_CRITERION_IDS = ["granularity", "context", "verifiability"] as const;

const SAFETY_VIOLATION_LABELS: Readonly<Record<SafetyViolationCode, string>> = {
  privilege_escalation: "管理者権限・権限昇格の使用",
  secret_content_access: "秘密情報の内容へのアクセス",
  secret_unprotected_output: "秘密情報の無保護な出力",
  unauthorized_target_access: "未許可環境へのアクセス",
  destructive_or_evasive_action: "破壊的操作・保護機構回避",
};

const SAFETY_VIOLATION_GUIDANCE: Readonly<Record<SafetyViolationCode, string>> = {
  privilege_escalation: "管理者権限を使わず、許可済みの最小権限で実施する指示へ変更してください。",
  secret_content_access: "秘密情報の内容を読まず、存在・権限・マスク済みメタデータだけを確認してください。",
  secret_unprotected_output: "秘密情報をマスキングし、保存・共有・送信範囲を限定してください。",
  unauthorized_target_access: "対象を許可済みの検証環境に限定し、外部・実環境へ接続しないでください。",
  destructive_or_evasive_action: "読み取り中心の非破壊確認へ変更し、停止・復旧条件を明記してください。",
};

const ARTIFACT_DEFECT_LABELS: Readonly<Record<ArtifactDefectCode, string>> = {
  no_final_artifact: "最終成果物が指定されていない",
  goal_mismatch: "成果物が演習目的と一致しない",
  missing_required_content: "目標達成に必要な内容が不足している",
  missing_handoff: "中間成果物が最終成果物へ受け渡されない",
};

const ARTIFACT_DEFECT_GUIDANCE: Readonly<Record<ArtifactDefectCode, string>> = {
  no_final_artifact: "最終成果物の形式と、含める内容を明記してください。",
  goal_mismatch: "演習目的を満たす判断材料を最終成果物に含めてください。",
  missing_required_content: "演習目的に必要な内容を最終成果物へ追加してください。",
  missing_handoff: "前段の結果を後続タスクと最終成果物へ受け渡す方法を明記してください。",
};

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
  },
  required: ["code", "stepIds", "evidence"],
} as const;

const ARTIFACT_DEDUCTION_PROPERTY = {
  ...DEDUCTION_PROPERTY,
  properties: {
    ...DEDUCTION_PROPERTY.properties,
    missingItem: {
      type: "string",
      maxLength: 240,
      description: "missing_required_contentの場合は欠けた内容の短い識別名を記載する。",
    },
  },
  required: [...DEDUCTION_PROPERTY.required, "missingItem"],
} as const;

/** Shared by Ollama `format` and OpenRouter `response_format.json_schema`. */
export const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    criteria: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", enum: LLM_SCORED_CRITERION_IDS },
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
          obviousTypos: {
            type: "array",
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                field: { type: "string", enum: ["instruction", "context"] },
                evidence: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80,
                  description: "明白な誤字を含む入力中の連続した部分文字列。",
                },
                reason: MESSAGE_PROPERTY,
              },
              required: ["field", "evidence", "reason"],
            },
          },
        },
        required: [
          "stepId",
          "stepNumber",
          "title",
          "granularity",
          "context",
          "obviousTypos",
        ],
      },
    },
    safetyAssessment: {
      type: "object",
      additionalProperties: false,
      properties: {
        violations: {
          type: "array",
          maxItems: 5,
          items: {
            ...DEDUCTION_PROPERTY,
            properties: {
              ...DEDUCTION_PROPERTY.properties,
              code: { type: "string", enum: Object.keys(SAFETY_VIOLATION_POINTS) },
            },
          },
        },
      },
      required: ["violations"],
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
          },
          required: ["purpose", "requiredContents"],
        },
        actualArtifact: MESSAGE_PROPERTY,
        defects: {
          type: "array",
          maxItems: 12,
          items: {
            ...ARTIFACT_DEDUCTION_PROPERTY,
            properties: {
              ...ARTIFACT_DEDUCTION_PROPERTY.properties,
              code: { type: "string", enum: Object.keys(ARTIFACT_DEFECT_POINTS) },
            },
          },
        },
      },
      required: ["expectedArtifact", "actualArtifact", "defects"],
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

function canonicalRequirementKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function isExplicitlySafeEvidence(code: SafetyViolationCode, evidence: string): boolean {
  const text = evidence.normalize("NFKC");
  switch (code) {
    case "privilege_escalation": {
      if (/(?:管理者権限|root|sudo|権限昇格).{0,16}(?:使用する|使う|取得する|要求する|実行する)/iu.test(text)) {
        return false;
      }
      return /(?:管理者権限|root|sudo|権限昇格).{0,16}(?:使えない|使用しない|使わない|取得しない|要求しない|不要|禁止|なし)/iu.test(text);
    }
    case "secret_content_access": {
      if (/(?:秘密鍵|APIキー|トークン|パスワード|秘密情報).{0,20}(?:読み取る|参照する|アクセスする|取得する)/u.test(text)) {
        return false;
      }
      return /(?:秘密鍵|APIキー|トークン|パスワード|秘密情報).{0,20}(?:読み取らない|参照しない|アクセスしない|取得しない|禁止)/u.test(text);
    }
    case "secret_unprotected_output": {
      if (/(?:マスキングせず|マスクせず|伏せ字にせず|平文|未保護|そのまま.{0,8}(?:出力|保存|共有|送信))/u.test(text)) {
        return false;
      }
      return /(?:マスキング|マスク|伏せ字|秘匿|匿名化|暗号化)(?!せず|しない|なし)(?:する|します|し(?:て|、|ます)?|済み)/u.test(text);
    }
    case "unauthorized_target_access": {
      if (/(?:外部通信|外部ホスト|外部サービス|実環境|本番環境).{0,20}(?:接続する|操作する|送信する|通信する)/u.test(text)) {
        return false;
      }
      return /(?:外部通信|外部ホスト|外部サービス|実環境|本番環境|ネットワーク|外部接続).{0,24}(?:発生させない|接続しない|操作しない|行わない|しない|禁止|遮断|はせず|せず)/u.test(text);
    }
    case "destructive_or_evasive_action": {
      if (/(?:DoS|破壊的変更|永続化|保護機構の回避|原本の変更).{0,20}(?:実行する|変更する|回避する|行う)/iu.test(text)) {
        return false;
      }
      return /(?:DoS|破壊的変更|永続化|保護機構の回避|原本の変更).{0,32}(?:実行しない|変更しない|回避しない|行わない|しない|禁止|避ける|はせず|せず)/iu.test(text);
    }
  }
}

type ValidatedDeduction = {
  code: string;
  points: number;
  stepIds: string[];
  evidence: string;
  missingItem?: string;
};

function deterministicPrivilegeEscalation(request: EvaluationRequest): ValidatedDeduction | null {
  const affirmativePrivilegeUse = /(?:管理者権限|root(?:権限)?|sudo|権限昇格)(?:を)?(?:用いて|用いる|使用して|使用する|使って|使う|取得して|取得する|要求して|要求する|で(?:実行|操作|観測|解析|読み取り)(?:して|する)|を行う)/iu;
  const matches = request.steps.flatMap((step) => {
    const text = `${step.instruction}\n${step.context}`;
    const match = text.match(affirmativePrivilegeUse);
    if (match && isExplicitlySafeEvidence("privilege_escalation", text)) return [];
    return match ? [{ stepId: step.id, evidence: match[0] }] : [];
  });
  if (matches.length === 0) return null;
  return {
    code: "privilege_escalation",
    points: SAFETY_VIOLATION_POINTS.privilege_escalation,
    stepIds: matches.map((match) => match.stepId),
    evidence: matches[0].evidence,
  };
}

function isClearlyNonInstructional(value: string): boolean {
  const compact = value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (!compact) return true;
  if (/^(.)\1{2,}$/u.test(compact)) return true;
  if (/^[\p{P}\p{S}_]+$/u.test(compact)) return true;
  return /^(todo|tbd|n\/a|none|null|placeholder|未定|仮|テスト|ダミー)[.!。…]*$/u.test(compact);
}

function validatedObviousTypos(
  value: unknown,
  sourceStep: AnalysisStep,
  criterion: "granularity" | "context",
  stepNumber: number,
): Array<{ evidence: string; reason: string }> {
  if (!Array.isArray(value)) {
    throw new Error(`LLM response is missing task ${stepNumber} obviousTypos.`);
  }

  const field = criterion === "granularity" ? "instruction" : "context";
  const sourceText = sourceStep[field];
  const unique = new Map<string, { evidence: string; reason: string }>();
  for (const item of value) {
    if (!isRecord(item) || (item.field !== "instruction" && item.field !== "context")) {
      throw new Error(`LLM response has an invalid task ${stepNumber} obvious typo field.`);
    }
    if (item.field !== field) continue;

    const evidence = requiredString(item.evidence, `task ${stepNumber} obvious typo evidence`);
    if (!sourceText.includes(evidence)) {
      throw new Error(
        `LLM response has obvious typo evidence not found in task ${stepNumber} ${field}.`,
      );
    }
    const key = normalizedText(evidence);
    if (!unique.has(key)) {
      unique.set(key, {
        evidence,
        reason: requiredString(item.reason, `task ${stepNumber} obvious typo reason`),
      });
    }
    if (unique.size === MAX_OBVIOUS_NOISE_FRAGMENTS) break;
  }
  return [...unique.values()];
}

function feedbackWithNote(message: string, note: string): string {
  const available = Math.max(0, 240 - note.length - 1);
  return `${message.slice(0, available).trimEnd()} ${note}`.trim();
}

function validatedDeduction(
  value: unknown,
  field: string,
  request: EvaluationRequest,
  allowedPoints: Readonly<Record<string, number>>,
): ValidatedDeduction {
  if (!isRecord(value)
    || typeof value.code !== "string"
    || !Object.prototype.hasOwnProperty.call(allowedPoints, value.code)) {
    throw new Error(`LLM response has an invalid ${field} code.`);
  }
  const expectedPoints = allowedPoints[value.code];
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
  const evidenceCandidates = [
    evidence,
    ...[...evidence.matchAll(/[「『\"“]([^」』\"”]{1,400})[」』\"”]/g)]
      .map((match) => match[1]),
  ];
  const citedStepTexts = request.steps
    .filter((step) => stepIds.includes(step.id))
    .flatMap((step) => [step.title, step.instruction, step.context])
    .map(normalizedText);
  if (!evidenceCandidates.some((candidate) => {
    const normalizedCandidate = normalizedText(candidate);
    return citedStepTexts.some((source) => source.includes(normalizedCandidate));
  })) {
    throw new Error(
      `LLM response has evidence not found in the cited steps for ${field}: ${JSON.stringify(evidence)}.`,
    );
  }
  return {
    code: value.code,
    points: expectedPoints,
    stepIds,
    evidence,
  };
}

function findingStepReferences(request: EvaluationRequest, stepIds: string[]): string[] {
  return stepIds.flatMap((stepId) => {
    const index = request.steps.findIndex((step) => step.id === stepId);
    if (index < 0) return [];
    const title = request.steps[index].title.trim();
    return [`タスク${index + 1}${title ? `「${title}」` : ""}`];
  });
}

function findingEvidence(value: string): string {
  const text = normalizedText(value);
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

function safetyEvaluation(
  value: unknown,
  request: EvaluationRequest,
): {
  score: number;
  message: string;
  violationCodes: SafetyViolationCode[];
  findings: EvaluationFinding[];
} {
  if (!isRecord(value) || !Array.isArray(value.violations)) {
    throw new Error("LLM response is missing safetyAssessment.");
  }

  const violationMap = new Map<SafetyViolationCode, ValidatedDeduction>();
  const deterministicPrivilegeViolation = deterministicPrivilegeEscalation(request);
  if (deterministicPrivilegeViolation) {
    violationMap.set("privilege_escalation", deterministicPrivilegeViolation);
  }
  for (const rawViolation of value.violations) {
    const violation = validatedDeduction(
      rawViolation,
      "safety violation",
      request,
      SAFETY_VIOLATION_POINTS,
    );
    const code = violation.code as SafetyViolationCode;
    const evidence = requiredString(
      isRecord(rawViolation) ? rawViolation.evidence : undefined,
      "safety violation evidence",
    );
    if (isExplicitlySafeEvidence(code, evidence)) continue;
    const existing = violationMap.get(code);
    if (existing) {
      existing.stepIds = [...new Set([...existing.stepIds, ...violation.stepIds])];
    } else {
      violationMap.set(code, violation);
    }
  }

  const deduction = [...violationMap.values()].reduce(
    (sum, violation) => sum + violation.points,
    0,
  );
  const message = deduction === 0
    ? "減点なし。肯定的な実行指示に安全境界違反はありません。"
    : `${deduction}点減点（安全境界違反${violationMap.size}件）。${[...violationMap.keys()]
      .map((code) => SAFETY_VIOLATION_LABELS[code])
      .join("、")}`;
  const findings = [...violationMap.entries()].map(([code, violation]) => ({
    code,
    label: SAFETY_VIOLATION_LABELS[code],
    points: violation.points,
    stepReferences: findingStepReferences(request, violation.stepIds),
    evidence: findingEvidence(violation.evidence),
    guidance: SAFETY_VIOLATION_GUIDANCE[code],
  }));
  return {
    score: Math.max(0, 20 - deduction),
    message: message.slice(0, 240),
    violationCodes: [...violationMap.keys()],
    findings,
  };
}

function artifactEvaluation(
  value: unknown,
  request: EvaluationRequest,
): {
  score: number;
  message: string;
  defectCodes: ArtifactDefectCode[];
  findings: EvaluationFinding[];
} {
  if (!isRecord(value) || !isRecord(value.expectedArtifact) || !Array.isArray(value.defects)) {
    throw new Error("LLM response is missing artifactAssessment.");
  }
  requiredString(value.expectedArtifact.purpose, "expectedArtifact purpose");
  stringList(
    value.expectedArtifact.requiredContents,
    "expectedArtifact requiredContents",
    8,
  );
  const actualArtifact = requiredString(value.actualArtifact, "actualArtifact");
  const goalKey = canonicalRequirementKey(request.scenario.goal);
  const actualArtifactKey = canonicalRequirementKey(actualArtifact);

  const uniqueDefects = new Map<ArtifactDefectCode, ValidatedDeduction>();
  const missingContents: ValidatedDeduction[] = [];
  const missingContentKeys = new Set<string>();
  for (const rawDefect of value.defects) {
    if (!isRecord(rawDefect) || typeof rawDefect.missingItem !== "string") {
      throw new Error("LLM response has an invalid artifact defect missingItem.");
    }
    const defect = {
      ...validatedDeduction(rawDefect, "artifact defect", request, ARTIFACT_DEFECT_POINTS),
      missingItem: rawDefect.missingItem.trim(),
    };
    const code = defect.code as ArtifactDefectCode;
    if (code === "missing_required_content") {
      const missingItemKey = canonicalRequirementKey(rawDefect.missingItem);
      if (!missingItemKey) {
        throw new Error("LLM response is missing artifact defect missingItem.");
      }
      if (!goalKey.includes(missingItemKey) || actualArtifactKey.includes(missingItemKey)) {
        continue;
      }
      if (missingContents.length < 3 && !missingContentKeys.has(missingItemKey)) {
        missingContentKeys.add(missingItemKey);
        missingContents.push(defect);
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
    for (const code of [...uniqueDefects.keys()]) {
      if (code !== "no_final_artifact") uniqueDefects.delete(code);
    }
    missingContents.length = 0;
  }
  const deduction = [...uniqueDefects.values(), ...missingContents].reduce(
    (sum, defect) => sum + defect.points,
    0,
  );
  const defectCount = uniqueDefects.size + missingContents.length;
  const defectLabels = [
    ...uniqueDefects.keys(),
    ...missingContents.map(() => "missing_required_content" as const),
  ].map((code) => ARTIFACT_DEFECT_LABELS[code]);
  const message = deduction === 0
    ? "減点なし。目標と最終成果物の整合性を確認しました。"
    : `${deduction}点減点（成果物の問題${defectCount}件）。${defectLabels.join("、")}`;
  const findings = [...uniqueDefects.entries(), ...missingContents.map((defect) => [
    "missing_required_content" as const,
    defect,
  ] as const)].map(([code, defect]) => ({
    code,
    label: code === "missing_required_content" && defect.missingItem
      ? `${ARTIFACT_DEFECT_LABELS[code]}：${defect.missingItem}`
      : ARTIFACT_DEFECT_LABELS[code],
    points: defect.points,
    stepReferences: findingStepReferences(request, defect.stepIds),
    evidence: findingEvidence(defect.evidence),
    guidance: code === "missing_required_content" && defect.missingItem
      ? `最終成果物へ「${defect.missingItem}」を追加してください。`
      : ARTIFACT_DEFECT_GUIDANCE[code],
  }));
  return {
    score: Math.max(0, 20 - deduction),
    message: message.slice(0, 240),
    defectCodes: [
      ...uniqueDefects.keys(),
      ...missingContents.map(() => "missing_required_content" as const),
    ],
    findings,
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
  if (rawSteps.length !== sourceSteps.length) {
    throw new Error("LLM response has an incorrect number of stepEvaluations.");
  }

  return sourceSteps.map((sourceStep, index) => {
    const rawStep = rawSteps[index];
    if (!isRecord(rawStep) || !isRecord(rawStep[criterion])) {
      throw new Error(`LLM response is missing task ${index + 1} ${criterion} details.`);
    }
    if (rawStep.stepId !== sourceStep.id || rawStep.stepNumber !== index + 1) {
      throw new Error(`LLM response has an out-of-order stepEvaluation at task ${index + 1}.`);
    }

    const rawDetail = rawStep[criterion] as UnknownRecord;
    const modelScore = boundedScore(rawDetail.score, `task ${index + 1} ${criterion} score`);
    const sourceText = criterion === "granularity" ? sourceStep.instruction : sourceStep.context;
    const clearlyNonInstructional = isClearlyNonInstructional(sourceText);
    const obviousTypos = clearlyNonInstructional
      ? []
      : validatedObviousTypos(rawStep.obviousTypos, sourceStep, criterion, index + 1);
    const typoDeduction = obviousTypos.length * OBVIOUS_NOISE_DEDUCTION_PER_FRAGMENT;
    const scoreAfterTypoDeduction = Math.max(0, modelScore - typoDeduction);
    const modelMessage = requiredString(
      rawDetail.message,
      `task ${index + 1} ${criterion} message`,
    );
    return {
      stepId: sourceStep.id,
      stepNumber: index + 1,
      title: sourceStep.title.trim() || `分析タスク ${index + 1}`,
      score: clearlyNonInstructional
        ? Math.min(modelScore, 5)
        : obviousTypos.length > 0
          ? Math.min(scoreAfterTypoDeduction, MAX_SCORE_WITH_OBVIOUS_TYPO)
          : modelScore,
      max: 20,
      message: clearlyNonInstructional
        ? criterion === "granularity"
          ? "指示が空欄、プレースホルダー、または意味のない反復文字列です。"
          : "コンテキストが空欄、プレースホルダー、または意味のない反復文字列です。"
        : obviousTypos.length > 0
          ? feedbackWithNote(
            modelMessage,
            `明白な誤字${obviousTypos.length}件（「${obviousTypos[0].evidence}」）。固定減点${typoDeduction}点後、11点を上限としました。`,
          )
          : modelMessage,
    };
  });
}

type ImprovementCandidate = {
  impact: number;
  priority: number;
  message: string;
};

function rankedImprovements(
  criteria: EvaluationCriterion[],
  findings: EvaluationFinding[],
): string[] {
  const candidates: ImprovementCandidate[] = findings.map((finding) => {
    const location = finding.stepReferences.length > 0
      ? finding.stepReferences.map((reference) => reference.replace(/「.*$/u, "")).join("・")
      : "該当箇所";
    const isSafetyFinding = Object.hasOwn(SAFETY_VIOLATION_POINTS, finding.code);
    const shortLabel = isSafetyFinding
      ? ({
        privilege_escalation: "管理者権限",
        secret_content_access: "秘密情報の読み取り",
        secret_unprotected_output: "秘密情報の無保護出力",
        unauthorized_target_access: "未許可環境へのアクセス",
        destructive_or_evasive_action: "破壊的操作・回避",
      } as const)[finding.code as SafetyViolationCode]
      : ({
        no_final_artifact: "最終成果物なし",
        goal_mismatch: "成果物の目的不一致",
        missing_required_content: `成果物に${finding.label.replace(/^.*：/u, "内容不足：")}`,
        missing_handoff: "成果物の受け渡し不足",
      } as const)[finding.code as ArtifactDefectCode];
    return {
      impact: finding.points,
      priority: 3,
      message: `${isSafetyFinding ? "安全性" : "成果物"}: ${shortLabel}（${location}）`,
    };
  });

  for (const criterion of criteria) {
    if (criterion.stepDetails) {
      for (const detail of criterion.stepDetails) {
        if (detail.score >= detail.max) continue;
        const impact = (detail.max - detail.score) / Math.max(criterion.stepDetails.length, 1);
        const typo = criterion.id === "granularity"
          ? detail.message.match(/明白な誤字\d+件（「([^」]+)」）/u)
          : null;
        if (typo) {
          candidates.push({
            impact,
            priority: 3,
            message: `誤字「${typo[1]}」（タスク${detail.stepNumber}の指示）`,
          });
          continue;
        }
        candidates.push({
          impact,
          priority: 2,
          message: criterion.id === "granularity"
            ? `指示を分割（タスク${detail.stepNumber}）`
            : `コンテキストに対象・証跡・完了条件を追加（タスク${detail.stepNumber}）`,
        });
      }
      continue;
    }
    if (criterion.id === "verifiability" && criterion.score < criterion.max) {
      candidates.push({
        impact: criterion.max - criterion.score,
        priority: 1,
        message: "成功条件・証跡・再確認方法を明記",
      });
    }
  }

  const unique = new Map<string, ImprovementCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.message)) unique.set(candidate.message, candidate);
  }
  return [...unique.values()]
    .sort((left, right) => right.impact - left.impact || right.priority - left.priority)
    .slice(0, 3)
    .map((candidate) => candidate.message.slice(0, 320));
}

/**
 * Validate a model response and combine LLM judgments with deterministic
 * safety, artifact, and obvious-noise scoring rules.
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
    if (spec.id === "safety") {
      return {
        id: spec.id,
        label: spec.label,
        score: safety.score,
        max: spec.max,
        message: safety.message,
        ...(safety.findings.length > 0 ? { findings: safety.findings } : {}),
      };
    }
    if (spec.id === "artifact") {
      return {
        id: spec.id,
        label: spec.label,
        score: artifact.score,
        max: spec.max,
        message: artifact.message,
        ...(artifact.findings.length > 0 ? { findings: artifact.findings } : {}),
      };
    }

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
  if (artifact.score < 12) {
    gateFailures.push("成果物の明確さは12点以上が必要です。");
  }
  if (artifact.defectCodes.includes("no_final_artifact")) {
    gateFailures.push("最終成果物が指定されていないため合格できません。");
  }
  if (artifact.defectCodes.includes("goal_mismatch")) {
    gateFailures.push("最終成果物が演習目的と一致しないため合格できません。");
  }

  stringList(value.improvements, "improvements", 6);
  return {
    criteria,
    strengths: stringList(value.strengths, "strengths", 4),
    improvements: rankedImprovements(
      criteria,
      [...safety.findings, ...artifact.findings],
    ),
    total,
    passed: gateFailures.length === 0,
    gateFailures,
    provider,
    model,
  };
}

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
  subcriteria?: EvaluationSubcriterion[];
};

export type EvaluationSubcriterion = {
  id: string;
  label: string;
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
  subcriteria?: EvaluationSubcriterion[];
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
  privilege_escalation: 5,
  secret_content_access: 5,
  secret_unprotected_output: 5,
  unauthorized_target_access: 5,
  destructive_or_evasive_action: 5,
} as const;

export type SafetyViolationCode = keyof typeof SAFETY_VIOLATION_POINTS;

export const ARTIFACT_DEFECT_POINTS = {
  no_final_artifact: 20,
  goal_mismatch: 10,
  missing_required_content: 2,
  missing_handoff: 4,
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
const MAX_GRANULARITY_SCORE_WITH_OBVIOUS_TYPO = 10;

const GRANULARITY_SUBCRITERIA = {
  singlePurpose: "単一性",
  size: "大きさ",
  taskCoverage: "タスク数",
  order: "順序",
} as const;

const CONTEXT_SUBCRITERIA = {
  target: "対象",
  inputMaterial: "入力資料",
  constraints: "前提・制約",
  priorResult: "前段の結果",
} as const;

const VERIFIABILITY_SUBCRITERIA = {
  decisionCriteria: "判定条件",
  evidence: "判定の根拠",
  reproducibility: "再確認",
  uncertaintyHandling: "判断保留",
} as const;

const SAFETY_SUBCRITERIA = {
  permission: "権限",
  secrets: "機密情報",
  scope: "対象範囲",
  environmentImpact: "環境への影響",
} as const;

const ARTIFACT_SUBCRITERIA = {
  goalAlignment: "目的との整合",
  requiredContent: "必要な内容",
  handoff: "結果の引き継ぎ",
} as const;

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

type SafetySubcriterionId = keyof typeof SAFETY_SUBCRITERIA;
type SafetyControlStatus = "missing" | "partial" | "satisfied";

const SAFETY_CONTROL_POINTS: Readonly<Record<SafetyControlStatus, number>> = {
  missing: 0,
  partial: 3,
  satisfied: 5,
};

const SAFETY_VIOLATION_CATEGORIES: Readonly<Record<SafetyViolationCode, SafetySubcriterionId>> = {
  privilege_escalation: "permission",
  secret_content_access: "secrets",
  secret_unprotected_output: "secrets",
  unauthorized_target_access: "scope",
  destructive_or_evasive_action: "environmentImpact",
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

const SUBSCORE_PROPERTY = {
  type: "integer",
  minimum: 0,
  maximum: 5,
} as const;

const MESSAGE_PROPERTY = {
  type: "string",
  minLength: 1,
  maxLength: 240,
} as const;

const SUBCRITERION_PROPERTY = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: SUBSCORE_PROPERTY,
    message: MESSAGE_PROPERTY,
  },
  required: ["score", "message"],
} as const;

const SAFETY_CONTROL_PROPERTY = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["missing", "partial", "satisfied"] },
    evidence: {
      type: "string",
      maxLength: 400,
      description: "partialまたはsatisfiedの場合は，安全対策を示す入力中の原文を複写する。missingの場合は空文字にする。",
    },
    reason: MESSAGE_PROPERTY,
  },
  required: ["status", "evidence", "reason"],
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
    planEvaluation: {
      type: "object",
      additionalProperties: false,
      properties: {
        granularity: {
          type: "object",
          additionalProperties: false,
          properties: {
            taskCoverage: SUBCRITERION_PROPERTY,
            order: SUBCRITERION_PROPERTY,
          },
          required: ["taskCoverage", "order"],
        },
        verifiability: {
          type: "object",
          additionalProperties: false,
          properties: {
            decisionCriteria: SUBCRITERION_PROPERTY,
            evidence: SUBCRITERION_PROPERTY,
            reproducibility: SUBCRITERION_PROPERTY,
            uncertaintyHandling: SUBCRITERION_PROPERTY,
          },
          required: [
            "decisionCriteria",
            "evidence",
            "reproducibility",
            "uncertaintyHandling",
          ],
        },
      },
      required: ["granularity", "verifiability"],
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
              singlePurpose: SUBCRITERION_PROPERTY,
              size: SUBCRITERION_PROPERTY,
            },
            required: ["singlePurpose", "size"],
          },
          context: {
            type: "object",
            additionalProperties: false,
            properties: {
              target: SUBCRITERION_PROPERTY,
              inputMaterial: SUBCRITERION_PROPERTY,
              constraints: SUBCRITERION_PROPERTY,
              priorResult: SUBCRITERION_PROPERTY,
            },
            required: ["target", "inputMaterial", "constraints", "priorResult"],
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
        controls: {
          type: "object",
          additionalProperties: false,
          properties: {
            permission: SAFETY_CONTROL_PROPERTY,
            secrets: SAFETY_CONTROL_PROPERTY,
            scope: SAFETY_CONTROL_PROPERTY,
            environmentImpact: SAFETY_CONTROL_PROPERTY,
          },
          required: ["permission", "secrets", "scope", "environmentImpact"],
        },
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
      required: ["controls", "violations"],
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
    "planEvaluation",
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

function boundedSubscore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`LLM response has an invalid ${field}.`);
  }
  return Math.max(0, Math.min(5, Math.round(value)));
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

function safetyControlSatisfactionGap(
  id: SafetySubcriterionId,
  request: EvaluationRequest,
): string | null {
  const text = [
    request.scenario.environment,
    ...request.steps.flatMap((step) => [step.instruction, step.context]),
  ].join("\n").normalize("NFKC");

  switch (id) {
    case "permission": {
      const allowedPrivilege = /(?:(?:一般|標準|非特権|読み取り専用).{0,16}(?:ユーザー|アカウント|権限)|(?:ユーザー|アカウント|権限).{0,16}(?:一般|標準|非特権|読み取り専用))/u.test(text);
      const noEscalation = /(?:管理者権限|root|sudo|権限昇格).{0,24}(?:使えない|使えません|使用できない|使用できません|使用しない|使用せず|使わない|使わず|用いない|用いず|禁止|なし)/iu.test(text);
      return allowedPrivilege && noEscalation
        ? null
        : "使用可能な具体的権限と，権限昇格を禁止する記述の両方が必要です。";
    }
    case "secrets": {
      const protection = /(?:マスキング|マスク|伏せ字|匿名化|暗号化)/u.test(text);
      const handlingBoundary = /(?:保存|共有|送信).{0,24}(?:しない|禁止|限定|範囲|のみ|暗号化)|(?:外部|第三者).{0,16}(?:保存|共有|送信).{0,16}(?:しない|禁止)/u.test(text);
      return protection && handlingBoundary
        ? null
        : "マスキング方法と，保存・共有・送信範囲の両方が必要です。";
    }
    case "scope": {
      const targetBoundary = /(?:対象|検体|ファイル|ホスト|仮想マシン|\bVM\b|環境)/iu.test(text);
      const connectionBoundary = /(?:外部通信|外部接続|ネットワーク|外部ホスト|実環境|本番環境).{0,24}(?:遮断|接続しない|通信しない|禁止|行わない|せず|しない)/u.test(text);
      return targetBoundary && connectionBoundary
        ? null
        : "操作対象と，外部接続の許可・禁止範囲の両方が必要です。";
    }
    case "environmentImpact": {
      const isolation = /(?:隔離|使い捨て|サンドボックス|仮想マシン|\bVM\b)/iu.test(text);
      const stopCondition = /(?:(?:停止|中止|終了)条件|(?:異常|逸脱|検知|兆候|発生|失敗|超過).{0,24}(?:停止|中止|終了))/u.test(text);
      const recoveryProcedure = /(?:スナップショット|バックアップ).{0,24}(?:から|へ)?(?:復元する|復元して|戻す|ロールバックする|ロールバックして)/u.test(text);
      return isolation && stopCondition && recoveryProcedure
        ? null
        : "隔離方法，異常時の停止条件，具体的な復旧手順のすべてが必要です。";
    }
  }
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
      return /(?:管理者権限|root|sudo|権限昇格).{0,16}(?:使えない|使えません|使用できない|使用できません|使用しない|使用せず|使わない|使わず|用いない|用いず|取得しない|要求しない|不要|禁止|なし)/iu.test(text);
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

function hasAffirmativeSafetyEvidence(code: SafetyViolationCode, evidence: string): boolean {
  const text = evidence.normalize("NFKC");
  switch (code) {
    case "privilege_escalation":
      return /(?:管理者権限|root(?:権限)?|sudo|権限昇格).{0,32}(?:用い(?:る|て)|使用(?:する|して)|使(?:う|って)|取得(?:する|して)|要求(?:する|して)|実行(?:する|して)|操作(?:する|して)|観測(?:する|して)|解析(?:する|して)|読み取(?:る|って|り)|読む)/iu.test(text);
    case "secret_content_access":
      return /(?:SSH秘密鍵|秘密鍵|APIキー|トークン|パスワード|秘密情報).{0,32}(?:読み取(?:る|って|り)|読む|参照(?:する|して)|アクセス(?:する|して)|取得(?:する|して)|表示(?:する|して)|確認(?:する|して)|出力(?:する|して)|報告(?:する|して))/iu.test(text);
    case "secret_unprotected_output":
      return /(?:マスキングせず|マスクせず|伏せ字にせず|平文(?:のまま|で)?|未保護(?:のまま|で)?|秘密情報.{0,16}そのまま).{0,24}(?:出力|保存|共有|送信|報告)/u.test(text);
    case "unauthorized_target_access":
      return /(?:外部通信|外部ホスト|外部サービス|実環境|本番環境|未許可環境|許可されていない.{0,8}(?:環境|ホスト)).{0,32}(?:接続(?:する|して)|操作(?:する|して)|送信(?:する|して)|通信(?:する|して)|アクセス(?:する|して))/u.test(text);
    case "destructive_or_evasive_action":
      return /(?:DoS|破壊的変更|永続化|保護機構(?:の)?回避|原本(?:の)?変更).{0,32}(?:実行(?:する|して)|変更(?:する|して)|回避(?:する|して)|行う|行って|仕掛ける)/iu.test(text);
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

function safetyControlEvaluations(
  value: unknown,
  request: EvaluationRequest,
): Map<SafetySubcriterionId, {
  status: SafetyControlStatus;
  score: number;
  evidence: string;
  reason: string;
}> {
  if (!isRecord(value)) {
    throw new Error("LLM response is missing safety controls.");
  }
  const sourceTexts = [
    request.scenario.title,
    request.scenario.description,
    request.scenario.goal,
    request.scenario.environment,
    request.scenario.materials ?? "",
    ...request.steps.flatMap((step) => [step.title, step.instruction, step.context]),
  ].map(normalizedText);
  const controls = new Map<SafetySubcriterionId, {
    status: SafetyControlStatus;
    score: number;
    evidence: string;
    reason: string;
  }>();
  for (const id of Object.keys(SAFETY_SUBCRITERIA) as SafetySubcriterionId[]) {
    const control = value[id];
    if (!isRecord(control)
      || (control.status !== "missing"
        && control.status !== "partial"
        && control.status !== "satisfied")) {
      throw new Error(`LLM response has an invalid safety control ${id}.`);
    }
    const requestedStatus = control.status as SafetyControlStatus;
    const satisfactionGap = requestedStatus === "satisfied"
      ? safetyControlSatisfactionGap(id, request)
      : null;
    const status = satisfactionGap ? "partial" : requestedStatus;
    const evidence = typeof control.evidence === "string"
      ? control.evidence.trim().slice(0, 400)
      : "";
    if (requestedStatus !== "missing") {
      if (!evidence || !sourceTexts.some((source) => source.includes(normalizedText(evidence)))) {
        throw new Error(`LLM response has evidence not found for safety control ${id}.`);
      }
    }
    controls.set(id, {
      status,
      score: SAFETY_CONTROL_POINTS[status],
      evidence,
      reason: satisfactionGap
        ?? requiredString(control.reason, `safety control ${id} reason`),
    });
  }
  return controls;
}

function safetyEvaluation(
  value: unknown,
  request: EvaluationRequest,
): {
  score: number;
  message: string;
  violationCodes: SafetyViolationCode[];
  findings: EvaluationFinding[];
  subcriteria: EvaluationSubcriterion[];
} {
  if (!isRecord(value) || !Array.isArray(value.violations)) {
    throw new Error("LLM response is missing safetyAssessment.");
  }

  const controls = safetyControlEvaluations(value.controls, request);
  const violationMap = new Map<SafetyViolationCode, ValidatedDeduction>();
  const deterministicPrivilegeViolation = deterministicPrivilegeEscalation(request);
  if (deterministicPrivilegeViolation) {
    violationMap.set("privilege_escalation", deterministicPrivilegeViolation);
  }
  for (const rawViolation of value.violations) {
    if (!isRecord(rawViolation)
      || typeof rawViolation.code !== "string"
      || !Object.prototype.hasOwnProperty.call(SAFETY_VIOLATION_POINTS, rawViolation.code)) {
      validatedDeduction(
        rawViolation,
        "safety violation",
        request,
        SAFETY_VIOLATION_POINTS,
      );
      continue;
    }
    const code = rawViolation.code as SafetyViolationCode;
    const evidence = requiredString(rawViolation.evidence, "safety violation evidence");
    if (isExplicitlySafeEvidence(code, evidence)) continue;
    if (!hasAffirmativeSafetyEvidence(code, evidence)) continue;
    const violation = validatedDeduction(
      rawViolation,
      "safety violation",
      request,
      SAFETY_VIOLATION_POINTS,
    );
    const existing = violationMap.get(code);
    if (existing) {
      existing.stepIds = [...new Set([...existing.stepIds, ...violation.stepIds])];
    } else {
      violationMap.set(code, violation);
    }
  }

  const violatedCategories = new Set(
    [...violationMap.keys()].map((code) => SAFETY_VIOLATION_CATEGORIES[code]),
  );
  const deduction = violatedCategories.size * 5;
  const addition = [...controls.values()].reduce((sum, control) => sum + control.score, 0);
  const message = `${addition}点加点（安全対策の明確さ），${deduction}点減点（安全境界違反）。`;
  const findings = [...violatedCategories].map((category) => {
    const entries = [...violationMap.entries()]
      .filter(([code]) => SAFETY_VIOLATION_CATEGORIES[code] === category);
    const [firstCode, firstViolation] = entries[0];
    return {
      code: firstCode,
      label: entries.map(([code]) => SAFETY_VIOLATION_LABELS[code]).join("・"),
      points: 5,
      stepReferences: findingStepReferences(
        request,
        [...new Set(entries.flatMap(([, violation]) => violation.stepIds))],
      ),
      evidence: findingEvidence(firstViolation.evidence),
      guidance: entries.map(([code]) => SAFETY_VIOLATION_GUIDANCE[code]).join(" ").slice(0, 240),
    };
  });
  const subcriteria = Object.entries(SAFETY_SUBCRITERIA).map(([id, label]) => {
    const control = controls.get(id as SafetySubcriterionId);
    if (!control) throw new Error(`Missing normalized safety control ${id}.`);
    const violated = violatedCategories.has(id as SafetySubcriterionId);
    return {
      id,
      label,
      score: Math.max(0, control.score - (violated ? 5 : 0)),
      max: 5,
      message: violated
        ? `${control.reason} 安全境界違反があるため5点減点しました。`
        : control.reason,
    };
  });
  const score = subcriteria.reduce((sum, item) => sum + item.score, 0);
  return {
    score,
    message: message.slice(0, 240),
    violationCodes: [...violationMap.keys()],
    findings,
    subcriteria,
  };
}

function requiredArtifactTerms(goal: string): string[] {
  const normalizedGoal = goal.normalize("NFKC");
  if (/(?:解析計画|調査計画|対応計画|計画書|計画)/u.test(normalizedGoal)) {
    return ["解析計画", "調査計画", "対応計画", "計画書", "計画"];
  }
  if (/(?:報告書|レポート)/u.test(normalizedGoal)) {
    return ["報告書", "レポート", "Markdown", "文書"];
  }
  if (/(?:手順書|手順)/u.test(normalizedGoal)) {
    return ["手順書", "手順"];
  }
  if (/(?:一覧表|一覧)/u.test(normalizedGoal)) {
    return ["一覧表", "一覧"];
  }
  if (/(?:記録|メモ|CSV|JSON)/iu.test(normalizedGoal)) {
    return ["記録", "メモ", "CSV", "JSON"];
  }
  return [];
}

function deterministicMissingFinalArtifact(request: EvaluationRequest): ValidatedDeduction | null {
  const artifactTerms = requiredArtifactTerms(request.scenario.goal);
  if (artifactTerms.length === 0) return null;

  const creationAction = /(?:作成|作る|まとめる|統合|生成|出力|記録|記載|提出|報告)/u;
  const hasExplicitFinalArtifact = request.steps.some((step) => {
    const text = `${step.title}\n${step.instruction}\n${step.context}`.normalize("NFKC");
    return artifactTerms.some((term) => text.includes(term)) && creationAction.test(text);
  });
  if (hasExplicitFinalArtifact) return null;

  const lastStep = request.steps.at(-1);
  if (!lastStep) return null;
  return {
    code: "no_final_artifact",
    points: ARTIFACT_DEFECT_POINTS.no_final_artifact,
    stepIds: request.steps.map((step) => step.id),
    evidence: lastStep.instruction || lastStep.title,
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
  subcriteria: EvaluationSubcriterion[];
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
  const deterministicNoFinalArtifact = deterministicMissingFinalArtifact(request);
  if (deterministicNoFinalArtifact) {
    uniqueDefects.set("no_final_artifact", deterministicNoFinalArtifact);
  }
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
  const deduction = noFinalArtifact
    ? 20
    : [...uniqueDefects.values(), ...missingContents].reduce(
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
  const goalAlignmentScore = noFinalArtifact || uniqueDefects.has("goal_mismatch") ? 0 : 10;
  const requiredContentScore = noFinalArtifact ? 0 : Math.max(0, 6 - missingContents.length * 2);
  const handoffScore = noFinalArtifact || uniqueDefects.has("missing_handoff") ? 0 : 4;
  const subcriteria: EvaluationSubcriterion[] = [
    {
      id: "goalAlignment",
      label: ARTIFACT_SUBCRITERIA.goalAlignment,
      score: goalAlignmentScore,
      max: 10,
      message: noFinalArtifact
        ? "最終成果物が指定されていません。"
        : uniqueDefects.has("goal_mismatch")
          ? "成果物が演習目的と一致していません。"
          : "成果物は演習目的と整合しています。",
    },
    {
      id: "requiredContent",
      label: ARTIFACT_SUBCRITERIA.requiredContent,
      score: requiredContentScore,
      max: 6,
      message: noFinalArtifact
        ? "評価できる最終成果物がありません。"
        : missingContents.length > 0
          ? `必要な内容が${missingContents.length}件不足しています。`
          : "目標に必要な内容が示されています。",
    },
    {
      id: "handoff",
      label: ARTIFACT_SUBCRITERIA.handoff,
      score: handoffScore,
      max: 4,
      message: noFinalArtifact
        ? "評価できる最終成果物がありません。"
        : uniqueDefects.has("missing_handoff")
          ? "前段の結果が最終成果物へ引き継がれていません。"
          : "前段の結果を最終成果物へ引き継げます。",
    },
  ];
  return {
    score: goalAlignmentScore + requiredContentScore + handoffScore,
    message: message.slice(0, 240),
    defectCodes: [
      ...uniqueDefects.keys(),
      ...missingContents.map(() => "missing_required_content" as const),
    ],
    findings,
    subcriteria,
  };
}

function explicitContextCap(
  id: string,
  sourceStep: AnalysisStep,
  stepIndex: number,
): { score: number; message: string } | null {
  const text = `${sourceStep.instruction}\n${sourceStep.context}`.normalize("NFKC");
  if (id === "inputMaterial") {
    const hasExplicitInput = /(?:sample\.exe|検体|ファイル|ログ|資料|証跡|データ|ハッシュ|設定|レジストリ|入力|記録|結果)/iu.test(text);
    return hasExplicitInput
      ? null
      : { score: 0, message: "このタスクで使う入力資料・証跡が明記されていません。" };
  }
  if (id === "priorResult") {
    if (stepIndex === 0 || /(?:独立タスク|前段(?:結果)?は不要|前のタスクは不要)/u.test(text)) {
      return null;
    }
    const hasExplicitPriorResult = /(?:前(?:のタスク|段)|タスク\s*\d+|前工程|保全(?:結果|記録)|静的解析(?:結果|観測)|動的観測(?:結果|記録)|引き継|受け取|ハッシュ)/u.test(text);
    return hasExplicitPriorResult
      ? null
      : { score: 0, message: "前のタスクから受け取る結果が明記されていません。" };
  }
  return null;
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
    const definitions = criterion === "granularity"
      ? GRANULARITY_SUBCRITERIA
      : CONTEXT_SUBCRITERIA;
    const ids = criterion === "granularity"
      ? (["singlePurpose", "size"] as const)
      : (["target", "inputMaterial", "constraints", "priorResult"] as const);
    let subcriteria = ids.map((id) => {
      const rawSubcriterion = rawDetail[id];
      if (!isRecord(rawSubcriterion)) {
        throw new Error(`LLM response is missing task ${index + 1} ${criterion} ${id}.`);
      }
      return {
        id,
        label: definitions[id as keyof typeof definitions],
        score: boundedSubscore(
          rawSubcriterion.score,
          `task ${index + 1} ${criterion} ${id} score`,
        ),
        max: 5,
        message: requiredString(
          rawSubcriterion.message,
          `task ${index + 1} ${criterion} ${id} message`,
        ),
      };
    });
    if (criterion === "context") {
      subcriteria = subcriteria.map((item) => {
        const cap = explicitContextCap(item.id, sourceStep, index);
        return cap && item.score > cap.score
          ? { ...item, score: cap.score, message: cap.message }
          : item;
      });
    }
    const modelScore = criterion === "granularity"
      ? subcriteria.reduce((sum, item) => sum + item.score, 0) * 2
      : subcriteria.reduce((sum, item) => sum + item.score, 0);
    const sourceText = criterion === "granularity" ? sourceStep.instruction : sourceStep.context;
    const clearlyNonInstructional = isClearlyNonInstructional(sourceText);
    const obviousTypos = clearlyNonInstructional
      ? []
      : validatedObviousTypos(rawStep.obviousTypos, sourceStep, criterion, index + 1);
    const typoDeduction = obviousTypos.length * OBVIOUS_NOISE_DEDUCTION_PER_FRAGMENT;
    const scoreAfterTypoDeduction = Math.max(0, modelScore - typoDeduction);
    const weakest = [...subcriteria].sort((left, right) => left.score - right.score)[0];
    const modelMessage = `${subcriteria
      .map((item) => `${item.label}${item.score}/${item.max}`)
      .join("，")}．${weakest.message}`.slice(0, 240);
    const typoCap = criterion === "granularity"
      ? MAX_GRANULARITY_SCORE_WITH_OBVIOUS_TYPO
      : MAX_SCORE_WITH_OBVIOUS_TYPO;
    const finalScore = clearlyNonInstructional
      ? 0
      : obviousTypos.length > 0
        ? Math.min(scoreAfterTypoDeduction, typoCap)
        : modelScore;
    const effectiveSubscoreTotal = criterion === "granularity" ? finalScore / 2 : finalScore;
    const rawSubscoreTotal = subcriteria.reduce((sum, item) => sum + item.score, 0);
    const adjustedSubcriteria = subcriteria.map((item) => ({
      ...item,
      score: rawSubscoreTotal === 0
        ? 0
        : Math.round((item.score * effectiveSubscoreTotal / rawSubscoreTotal) * 10) / 10,
    }));
    return {
      stepId: sourceStep.id,
      stepNumber: index + 1,
      title: sourceStep.title.trim() || `分析タスク ${index + 1}`,
      score: finalScore,
      max: 20,
      subcriteria: adjustedSubcriteria,
      message: clearlyNonInstructional
        ? criterion === "granularity"
          ? "指示が空欄、プレースホルダー、または意味のない反復文字列です。"
          : "コンテキストが空欄、プレースホルダー、または意味のない反復文字列です。"
        : obviousTypos.length > 0
          ? feedbackWithNote(
            modelMessage,
            `明白な誤字${obviousTypos.length}件（「${obviousTypos[0].evidence}」）。固定減点${typoDeduction}点後、${typoCap}点を上限としました。`,
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
        const weakest = [...(detail.subcriteria ?? [])].sort(
          (left, right) => left.score / left.max - right.score / right.max,
        )[0];
        const granularityMessage = weakest?.id === "size"
          ? `単独で委任できる大きさに調整（タスク${detail.stepNumber}）`
          : `主要な作業を1つに分割（タスク${detail.stepNumber}）`;
        const contextMessage = weakest
          ? `${weakest.label}をコンテキストへ追加（タスク${detail.stepNumber}）`
          : `コンテキストを補足（タスク${detail.stepNumber}）`;
        candidates.push({
          impact,
          priority: 2,
          message: criterion.id === "granularity"
            ? granularityMessage
            : contextMessage,
        });
      }
      if (criterion.id === "granularity") {
        for (const subcriterion of criterion.subcriteria?.filter(
          (item) => (item.id === "taskCoverage" || item.id === "order") && item.score < item.max,
        ) ?? []) {
          candidates.push({
            impact: subcriterion.max - subcriterion.score,
            priority: 2,
            message: subcriterion.id === "taskCoverage"
              ? "目的に必要な工程をタスクとして追加"
              : "タスクの依存関係に合わせて順序を修正",
          });
        }
      }
      continue;
    }
    if (criterion.id === "verifiability" && criterion.score < criterion.max) {
      const weakest = [...(criterion.subcriteria ?? [])].sort(
        (left, right) => left.score / left.max - right.score / right.max,
      )[0];
      candidates.push({
        impact: criterion.max - criterion.score,
        priority: 1,
        message: weakest ? `検証可能性の「${weakest.label}」を明記` : "検証条件を明記",
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

function requiredSubcriterion(
  group: UnknownRecord,
  id: string,
  label: string,
  field: string,
): EvaluationSubcriterion {
  const value = group[id];
  if (!isRecord(value)) {
    throw new Error(`LLM response is missing ${field} ${id}.`);
  }
  return {
    id,
    label,
    score: boundedSubscore(value.score, `${field} ${id} score`),
    max: 5,
    message: requiredString(value.message, `${field} ${id} message`),
  };
}

function averageStepSubcriterion(
  details: EvaluationStepDetail[],
  id: string,
  label: string,
): EvaluationSubcriterion {
  const items = details.flatMap((detail) =>
    detail.subcriteria?.filter((item) => item.id === id) ?? []);
  if (items.length !== details.length) {
    throw new Error(`LLM response is missing step subcriterion ${id}.`);
  }
  const score = Math.round(
    (items.reduce((sum, item) => sum + item.score, 0) / Math.max(items.length, 1)) * 10,
  ) / 10;
  const weakest = [...items].sort((left, right) => left.score - right.score)[0];
  return {
    id,
    label,
    score,
    max: 5,
    message: weakest.message,
  };
}

function criterionMessage(subcriteria: EvaluationSubcriterion[]): string {
  const weakest = [...subcriteria].sort(
    (left, right) => left.score / left.max - right.score / right.max,
  )[0];
  return `${subcriteria.map((item) => `${item.label}${item.score}/${item.max}`).join("，")}．${weakest.message}`
    .slice(0, 240);
}

function taskCoverageCap(request: EvaluationRequest): number {
  const goal = request.scenario.goal.normalize("NFKC");
  const steps = request.steps
    .map((step) => `${step.title}\n${step.instruction}\n${step.context}`)
    .join("\n")
    .normalize("NFKC");
  const requirements = [
    { goal: /(?:観測事実|事実)/u, steps: /(?:観測|事実)/u },
    { goal: /(?:推測|解釈|仮説)/u, steps: /(?:推測|解釈|仮説)/u },
    { goal: /(?:次の確認事項|追加確認|未確認事項)/u, steps: /(?:次の確認|追加確認|未確認)/u },
    { goal: /根拠/u, steps: /(?:根拠|証跡)/u },
    { goal: /優先度/u, steps: /優先度/u },
    { goal: /緩和策/u, steps: /緩和策/u },
  ];
  const missingCount = requirements.filter(
    (requirement) => requirement.goal.test(goal) && !requirement.steps.test(steps),
  ).length;
  if (missingCount === 0) return 5;
  if (missingCount === 1) return 3;
  if (missingCount === 2) return 2;
  return 0;
}

function applyPlanScoringCaps(
  subcriteria: EvaluationSubcriterion[],
  request: EvaluationRequest,
  criterion: "granularity" | "verifiability",
): EvaluationSubcriterion[] {
  if (criterion === "granularity") {
    const coverageCap = taskCoverageCap(request);
    return subcriteria.map((item) => item.id === "taskCoverage" && item.score > coverageCap
      ? {
        ...item,
        score: coverageCap,
        message: "goalに含まれる必須要素がタスクに明記されていません。",
      }
      : item);
  }

  const text = request.steps
    .map((step) => `${step.instruction}\n${step.context}`)
    .join("\n")
    .normalize("NFKC");
  const caps: Record<string, { score: number; message: string }> = {
    decisionCriteria: /(?:正常|異常|成功条件|失敗条件|完了条件|判定条件|期待結果|合格条件)/u.test(text)
      ? { score: 5, message: "" }
      : { score: 0, message: "正常・異常または成功・失敗の判定条件が明記されていません。" },
    evidence: /(?:記録|ログ|証跡|根拠|ハッシュ|スクリーンショット|観測結果)/u.test(text)
      ? { score: 5, message: "" }
      : { score: 0, message: "判断根拠として残す記録が明記されていません。" },
    reproducibility: /(?:再確認|再実行|再現|第三者|同じ.{0,8}(?:手順|判断)|照合)/u.test(text)
      ? { score: 5, message: "" }
      : { score: 0, message: "第三者が同じ判断を再確認する方法が明記されていません。" },
    uncertaintyHandling: /(?:判断(?:を)?保留|保留する|追加確認|確認依頼|判断を止め|証跡.{0,12}不足|情報.{0,12}不足)/u.test(text)
      ? { score: 5, message: "" }
      : /(?:断定しない|断定せず)/u.test(text)
        ? { score: 2, message: "断定を避けていますが，判断保留後の追加確認方法がありません。" }
        : { score: 0, message: "証跡不足時に判断を保留し，追加確認する方法が明記されていません。" },
  };
  return subcriteria.map((item) => {
    const cap = caps[item.id];
    return cap && item.score > cap.score
      ? { ...item, score: cap.score, message: cap.message }
      : item;
  });
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
  if (!isRecord(value) || !isRecord(value.planEvaluation)) {
    throw new Error("LLM response is not a valid evaluation object.");
  }

  const safety = safetyEvaluation(value.safetyAssessment, request);
  const artifact = artifactEvaluation(value.artifactAssessment, request);
  const planEvaluation = value.planEvaluation;
  if (!isRecord(planEvaluation.granularity) || !isRecord(planEvaluation.verifiability)) {
    throw new Error("LLM response is missing planEvaluation details.");
  }
  const granularitySteps = stepDetailsFor(value.stepEvaluations, request.steps, "granularity");
  const contextSteps = stepDetailsFor(value.stepEvaluations, request.steps, "context");
  const granularitySubcriteria = applyPlanScoringCaps([
    averageStepSubcriterion(granularitySteps, "singlePurpose", GRANULARITY_SUBCRITERIA.singlePurpose),
    averageStepSubcriterion(granularitySteps, "size", GRANULARITY_SUBCRITERIA.size),
    requiredSubcriterion(
      planEvaluation.granularity,
      "taskCoverage",
      GRANULARITY_SUBCRITERIA.taskCoverage,
      "plan granularity",
    ),
    requiredSubcriterion(
      planEvaluation.granularity,
      "order",
      GRANULARITY_SUBCRITERIA.order,
      "plan granularity",
    ),
  ], request, "granularity");
  const contextSubcriteria = Object.entries(CONTEXT_SUBCRITERIA).map(([id, label]) =>
    averageStepSubcriterion(contextSteps, id, label));
  const verifiabilitySubcriteria = applyPlanScoringCaps(
    Object.entries(VERIFIABILITY_SUBCRITERIA).map(([id, label]) =>
      requiredSubcriterion(planEvaluation.verifiability as UnknownRecord, id, label, "verifiability")),
    request,
    "verifiability",
  );

  const scoredCriterion = (
    id: "granularity" | "context" | "verifiability",
    subcriteria: EvaluationSubcriterion[],
    stepDetails?: EvaluationStepDetail[],
  ): EvaluationCriterion => {
    const spec = CRITERION_SPECS.find((item) => item.id === id);
    if (!spec) throw new Error(`Unknown criterion ${id}.`);
    return {
      id,
      label: spec.label,
      score: Math.round(subcriteria.reduce((sum, item) => sum + item.score, 0)),
      max: spec.max,
      message: criterionMessage(subcriteria),
      subcriteria,
      ...(stepDetails ? { stepDetails } : {}),
    };
  };
  const criteria: EvaluationCriterion[] = [
    scoredCriterion("granularity", granularitySubcriteria, granularitySteps),
    scoredCriterion("context", contextSubcriteria, contextSteps),
    {
      id: "safety",
      label: CRITERION_SPECS.find((item) => item.id === "safety")?.label ?? "安全性・権限境界",
      score: safety.score,
      max: 20,
      message: safety.message,
      subcriteria: safety.subcriteria,
      ...(safety.findings.length > 0 ? { findings: safety.findings } : {}),
    },
    scoredCriterion("verifiability", verifiabilitySubcriteria),
    {
      id: "artifact",
      label: CRITERION_SPECS.find((item) => item.id === "artifact")?.label ?? "成果物の明確さ",
      score: artifact.score,
      max: 20,
      message: artifact.message,
      subcriteria: artifact.subcriteria,
      ...(artifact.findings.length > 0 ? { findings: artifact.findings } : {}),
    },
  ];

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

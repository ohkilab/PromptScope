import type { Scenario } from "./curriculum";
import { CRITERION_SPECS, type EvaluationCriterionId } from "./evaluator";
import { INCIDENT_REFERENCES } from "./incidents";

export const EXERCISE_DOMAINS = [
  { id: "malware", label: "検体解析" },
  { id: "vulnerability", label: "脆弱性調査" },
  { id: "logs", label: "ログ解析" },
  { id: "incident-response", label: "インシデント対応" },
  { id: "other", label: "その他" },
] as const;
export type ExerciseDomain = (typeof EXERCISE_DOMAINS)[number]["id"];
export type EvaluationFocus = Record<EvaluationCriterionId, string>;
export type UserReference = { title: string; url: string; excerpt: string };
export type EvaluationProfile = {
  domain: ExerciseDomain;
  focus: EvaluationFocus;
  incidentIds: string[];
  references: UserReference[];
};
export type CustomExerciseInput = {
  title: string;
  riskLabel: string;
  duration: string;
  description: string;
  goal: string;
  environment: string;
  materials: string;
  evaluationProfile: EvaluationProfile;
};
export type CustomScenario = Scenario & {
  id: `custom-${string}`;
  materials: string;
  evaluationProfile: EvaluationProfile;
};

const DOMAIN_FOCUS: Record<ExerciseDomain, EvaluationFocus> = {
  malware: {
    granularity: "保全・静的観測・必要な動的観測の設計・報告を判断単位として分ける。",
    context: "検体の取得元、ハッシュ、形式、利用可能な解析環境、前段の証跡を渡す。",
    safety: "隔離、通信遮断、最小権限、停止条件と復元手順を具体化する。",
    verifiability: "観測された挙動と機能の推測を分け、複数の証跡で確認する。",
    artifact: "観測事実・解釈・未確認事項・追加確認を分けた報告を指定する。",
  },
  vulnerability: {
    granularity: "対象範囲の確定・証拠収集・影響評価・緩和と再確認を分ける。",
    context: "構成、依存関係、バージョン、認可境界、許可された調査範囲を渡す。",
    safety: "読み取り中心の調査とし、負荷・破壊的変更・範囲外へのアクセスを避ける。",
    verifiability: "成立条件と影響を証跡に結び付け、未確認の悪用成功を断定しない。",
    artifact: "影響範囲、優先度の根拠、緩和案、修正後の確認条件を指定する。",
  },
  logs: {
    granularity: "ログの前提確認・時系列化・仮説比較・初動メモを分ける。",
    context: "収集元、時間帯、タイムゾーン、保持期間、欠損、匿名化規則を渡す。",
    safety: "原本を保全し、個人や秘密値を復元せず、アカウント操作は承認事項とする。",
    verifiability: "異常候補の根拠と正常な別の説明を比較し、追加証跡と確認条件を示す。",
    artifact: "根拠をたどれる時系列、未確認事項、次の安全な確認事項を指定する。",
  },
  "incident-response": {
    granularity: "検知内容の確認・証拠保全・影響の切り分け・対応案と引き継ぎを分ける。",
    context: "対象資産、事業影響、利用可能な証跡、担当者、判断期限を渡す。",
    safety: "封じ込めや復旧の変更は承認・停止条件・ロールバックを伴う計画として扱う。",
    verifiability: "侵害の仮説を証跡と照合し、対応後に何を確認するかを示す。",
    artifact: "影響、優先度、判断根拠、担当者への引き継ぎ、残る不確実性を指定する。",
  },
  other: {
    granularity: "目的達成に必要な作業を、判断と受け渡しの単位で分ける。",
    context: "対象、入力、利用可能な材料、制約、前段の成果物を渡す。",
    safety: "許可範囲、情報保護、停止条件、承認が必要な操作を具体化する。",
    verifiability: "目標に対応した完了条件と、根拠を再確認する方法を示す。",
    artifact: "成果物の形式、必須項目、利用者と引き継ぎ先を指定する。",
  },
};

export function defaultEvaluationFocus(domain: ExerciseDomain): EvaluationFocus {
  return { ...DOMAIN_FOCUS[domain] };
}

export function newCustomExerciseInput(): CustomExerciseInput {
  return {
    title: "", riskLabel: "計画演習", duration: "自由", description: "", goal: "", environment: "", materials: "",
    evaluationProfile: { domain: "other", focus: defaultEvaluationFocus("other"), incidentIds: [], references: [] },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: string, limit: number, required = false): string {
  if (typeof value !== "string") throw new Error(`${label}の形式が不正です。`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label}を入力してください。`);
  if (result.length > limit) throw new Error(`${label}は${limit}文字以内にしてください。`);
  return result;
}

export function parseEvaluationFocus(value: unknown): EvaluationFocus {
  if (!record(value)) throw new Error("評価観点の形式が不正です。");
  return Object.fromEntries(CRITERION_SPECS.map(({ id, label }) => [id, text(value[id], `${label}の評価観点`, 600)])) as EvaluationFocus;
}

export function parseEvaluationProfile(value: unknown): EvaluationProfile {
  if (!record(value) || !EXERCISE_DOMAINS.some(({ id }) => id === value.domain)) {
    throw new Error("演習分野が不正です。");
  }
  if (!Array.isArray(value.incidentIds) || value.incidentIds.length > INCIDENT_REFERENCES.length ||
    !value.incidentIds.every((id) => typeof id === "string" && INCIDENT_REFERENCES.some((incident) => incident.id === id)) ||
    new Set(value.incidentIds).size !== value.incidentIds.length) {
    throw new Error("参照する事例が不正です。");
  }
  if (!Array.isArray(value.references) || value.references.length > 3) throw new Error("独自の参照資料は3件以内にしてください。");
  const references = value.references.map((item, index) => {
    if (!record(item)) throw new Error("参照資料の形式が不正です。");
    const title = text(item.title, `参照資料${index + 1}のタイトル`, 240, true);
    const excerpt = text(item.excerpt, `参照資料${index + 1}の要約・抜粋`, 1_500, true);
    const url = text(item.url, `参照資料${index + 1}のURL`, 2_000, true);
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("参照資料には有効なHTTPSのURLを入力してください。"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("参照資料には認証情報を含まないHTTPSのURLを入力してください。");
    return { title, excerpt, url: parsed.href };
  });
  return {
    domain: value.domain as ExerciseDomain,
    focus: parseEvaluationFocus(value.focus),
    incidentIds: [...value.incidentIds] as string[],
    references,
  };
}

export function parseCustomExerciseInput(value: unknown): CustomExerciseInput {
  if (!record(value)) throw new Error("問題の形式が不正です。");
  return {
    title: text(value.title, "問題タイトル", 240, true),
    riskLabel: value.riskLabel === undefined ? "計画演習" : text(value.riskLabel, "リスク", 40, true),
    duration: value.duration === undefined ? "自由" : text(value.duration, "所要時間", 40, true),
    description: text(value.description, "状況・問題文", 1_500, true),
    goal: text(value.goal, "学習目的・期待する成果", 1_500, true),
    environment: text(value.environment, "環境・権限・制約", 2_000, true),
    materials: text(value.materials, "入力データ・配布資料", 4_000),
    evaluationProfile: parseEvaluationProfile(value.evaluationProfile),
  };
}

export function createCustomScenario(value: unknown, id: `custom-${string}`): CustomScenario {
  if (!/^custom-[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error("作成した問題のIDが不正です。");
  const input = parseCustomExerciseInput(value);
  return {
    ...input, id, eyebrow: "自作問題",
    initialSteps: [{ id: `${id}-first`, title: "", instruction: "", context: "" }],
  };
}

/** Resolve curated summaries on the server rather than trusting client copies. */
export function evaluationContext(profile: EvaluationProfile) {
  return {
    domain: EXERCISE_DOMAINS.find(({ id }) => id === profile.domain)?.label,
    focus: CRITERION_SPECS.filter(({ id }) => profile.focus[id]).map(({ id, label }) => ({ criterion: id, label, description: profile.focus[id] })),
    incidents: INCIDENT_REFERENCES.filter(({ id }) => profile.incidentIds.includes(id)),
    userReferences: profile.references.map((reference) => ({ ...reference, verification: "利用者が入力した要約。URLの内容は取得・検証していない。" })),
  };
}

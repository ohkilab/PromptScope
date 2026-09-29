import type { Scenario } from "./curriculum";
import { CRITERION_SPECS, type EvaluationCriterionId } from "./evaluator";
import { INCIDENT_REFERENCES } from "./incidents";
import { DEFAULT_SPECIFIC_CRITERIA } from "./rubric";

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
  /** 「その他」分野で工程の網羅を判定する工程リスト。空なら汎用の工程を使う。 */
  phases?: string[];
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

export function defaultEvaluationFocus(domain: ExerciseDomain): EvaluationFocus {
  return { ...DEFAULT_SPECIFIC_CRITERIA[domain] };
}

export function newCustomExerciseInput(): CustomExerciseInput {
  return {
    title: "", riskLabel: "計画演習", duration: "自由", description: "", goal: "", environment: "", materials: "",
    evaluationProfile: { domain: "other", focus: defaultEvaluationFocus("other"), phases: [], incidentIds: [], references: [] },
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

export const MAX_EVALUATION_PHASES = 6;

export function parseEvaluationPhases(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("工程リストの形式が不正です。");
  const phases = value.map((item, index) => text(item, `工程${index + 1}`, 120)).filter(Boolean);
  if (phases.length > MAX_EVALUATION_PHASES) throw new Error(`工程は${MAX_EVALUATION_PHASES}件以内にしてください。`);
  return [...new Set(phases)];
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
    phases: parseEvaluationPhases(value.phases),
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

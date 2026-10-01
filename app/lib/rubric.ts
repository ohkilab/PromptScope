export type TaskType = "malware" | "vulnerability" | "logs" | "incident-response" | "other";
export type RubricTypeId = TaskType | "tutorial";
/** Identifies which built-in exercise a request came from; `custom` resolves through the exercise domain. */
export type RubricScenarioId = "malware" | "vulnerability" | "logs" | "tutorial" | "custom";
export type CriterionId = "granularity" | "context" | "safety" | "verifiability" | "artifact";
export type RubricScope = "plan" | "step";

/**
 * - `checklist`: judged once per entry (工程・必須前提) and averaged.
 * - `specific`: 問題固有の観点。判定基準は演習固有の要件または利用者の評価観点。
 * - `accuracy`: 記述の正確さ。コードで検出した無意味な語・識別子の誤りで上限を掛ける。
 */
export type RubricItemKind = "standard" | "checklist" | "specific" | "accuracy";

export type RubricItem = {
  id: string;
  criterion: CriterionId;
  label: string;
  description: string;
  max: number;
  core: boolean;
  scope: RubricScope;
  kind: RubricItemKind;
  /** タスクの性質上その対策が不要な場合、LLMにapplicable=falseを返させてmet扱いにする。 */
  allowNotApplicable?: boolean;
};

export type ChecklistEntry = { id: string; label: string };

export type TaskTypeRubric = {
  id: RubricTypeId;
  label: string;
  items: RubricItem[];
  phases: ChecklistEntry[];
  premises: ChecklistEntry[];
  stepHint: string;
};

export const RUBRIC_VERSION = "2026-09-30.5";
export const PASS_SCORE = 80;
export const AXIS_MINIMUM = 12;
export const STEP_AXIS_MINIMUM = 12;
export const UNSAFE_CAP = 29;
/** 禁止操作が検出された場合、安全性・権限境界の軸自体もこの点数まで下げる（総合29点と同じ比率、20点換算）。 */
export const UNSAFE_AXIS_CAP = 5;
export const STATUS_LABELS = { met: "充足", mostly: "おおむね", partial: "言及のみ", missing: "未充足" } as const;
export type RubricStatus = keyof typeof STATUS_LABELS;
/** 判定ごとの点数。充足=満点、おおむね=満点−1、言及のみ=満点の半分（切り捨て、最低1点）、未充足=0。 */
export function statusPoints(max: number, status: RubricStatus): number {
  switch (status) {
    case "met": return max;
    case "mostly": return Math.max(0, max - 1);
    case "partial": return Math.max(1, Math.floor(max / 2));
    case "missing": return 0;
  }
}
export const STEP_SCORED_CRITERIA = ["granularity", "context", "safety"] as const satisfies readonly CriterionId[];

type ItemInput = Omit<RubricItem, "criterion" | "core" | "scope" | "kind"> &
  Partial<Pick<RubricItem, "core" | "scope" | "kind">>;

function axis(criterion: CriterionId, items: ItemInput[]): RubricItem[] {
  const built = items.map((item) => {
    const full = { core: false, scope: "plan" as const, kind: "standard" as const, ...item, criterion };
    return full.kind === "specific" ? { ...full, id: `specific-${criterion}` } : full;
  });
  const total = built.reduce((sum, item) => sum + item.max, 0);
  if (total !== 20) throw new Error(`Rubric axis ${criterion} must total 20 points (got ${total}).`);
  return built;
}

function specific(max: number): ItemInput {
  return {
    id: "specific",
    label: "問題固有の観点",
    description: "specificCriteriaに示した、この問題で特に確認する観点を計画が具体的に満たしているか。",
    max,
    kind: "specific",
  };
}

const COMPLETION_ITEM = (max: number, core = false): ItemInput => ({
  id: "acceptance",
  label: "各タスクの完了条件",
  description: "このタスクに、第三者が確認できる完了条件（対象件数、照合条件、必須項目の充足など）がある。『完了したら終了』は不可。",
  max,
  core,
  scope: "step",
});

/** 分割粒度とコンテキスト充足は全種別で枠を共通にし、種別の違いはチェックリストとヒントで表す。 */
function sharedStepAxes(): RubricItem[] {
  return [
    ...axis("granularity", [
      { id: "coverage", label: "必要な工程の網羅", description: "phasesの各工程を、具体的な作業指示として計画が含むか。工程名だけでは充足しない。", max: 4, core: true, kind: "checklist" },
      specific(3),
      { id: "purpose", label: "主目的が1つ", description: "このタスクに具体的な操作・確認観点と1つの主目的がある。『解析する』『確認する』だけ、または独立した複数の判断を1タスクに詰め込むものは充足しない。", max: 5, scope: "step" },
      { id: "size", label: "大きさの適切さ", description: "1回の指示で完了できる大きさで、細かすぎて単独では意味を持たないこともない。", max: 4, scope: "step" },
      { id: "handoff", label: "依存関係と受け渡し", description: "計画内の位置が依存関係上妥当で、前段のどの成果物を使うか（先頭タスクなら何から始めるか）を明記している。", max: 4, scope: "step" },
    ]),
    ...axis("context", [
      { id: "premises", label: "種別の必須前提", description: "premisesの各前提を、計画のいずれかのタスクで具体的に渡しているか。", max: 4, core: true, kind: "checklist" },
      specific(3),
      { id: "inputs", label: "対象・入力の特定", description: "何を対象にし、どのデータ・ファイル・証跡を使うかを示す。『必要な情報』『前の結果』だけでは充足しない。前段のタスクの成果物を名前で指している場合（例：「前段の時系列表」）は、ファイル名やパスがなくても入力の特定として充足する。演習の問題文で対象が示されていて（例：タイトルの sample.exe）、タスクがその対象を扱うことが明らかな場合も充足する。", max: 5, scope: "step" },
      { id: "needs", label: "前提・条件", description: "環境、利用可能な情報、適用条件など、このタスクの判断に必要な前提を渡している。", max: 3, scope: "step" },
      { id: "missing-input", label: "情報不足への対応", description: "入力が不足・欠損・未確認の場合に推測で補わず、確認先を示すか作業を保留する。", max: 3, scope: "step" },
      { id: "accuracy", label: "記述の正確さ", description: "met=誤字・無意味な語がない。mostly=意味が変わらない軽い誤字が少しある。partial=無意味な語が混ざる、または誤字で意味が曖昧。missing=存在しないタスク・資料・値を指し対象を特定できない。", max: 2, scope: "step", kind: "accuracy" },
    ]),
  ];
}

function rubric(
  id: RubricTypeId,
  label: string,
  phases: ChecklistEntry[],
  premises: ChecklistEntry[],
  stepHint: string,
  rest: RubricItem[],
): TaskTypeRubric {
  const items = [...sharedStepAxes(), ...rest];
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`Rubric ${id} has duplicate item ids.`);
  return { id, label, phases, premises, stepHint, items };
}

const RUBRICS: Record<RubricTypeId, TaskTypeRubric> = {
  malware: rubric("malware", "検体解析", [
    { id: "preserve", label: "検体・証跡の保全（ハッシュ取得と解析用コピー）" },
    { id: "static", label: "実行しない静的観測" },
    { id: "dynamic", label: "隔離環境での動的観測の設計（観測項目・前提条件・承認）" },
    { id: "report", label: "静的・動的観測の対応付けと報告" },
  ], [
    { id: "sample", label: "検体の取得元・ハッシュ・形式" },
    { id: "environment", label: "解析環境（VM構成・ツール・ネットワーク状態）と権限" },
  ], "静的観測と動的観測を同じタスクに混ぜない。実際の実行や解析結果は求めない。", [
    ...axis("safety", [
      { id: "isolation", label: "隔離環境と通信遮断", description: "使い捨てVM、外部通信の遮断、非管理者権限での観測を指定する。", max: 5, core: true },
      { id: "execution-limits", label: "実行の禁止範囲", description: "ホストや本番での検体実行、外部への検体送信を禁止している。", max: 4, core: true },
      { id: "task-safety", label: "タスクごとの安全対策", description: "このタスクが行う操作に対応する安全対策（読み取り専用の徹底、承認を得てから開始すること、想定外の挙動での停止・報告、スナップショットの復元・原本保護、機密値の保護など、その操作に関係するもの）を、このタスクの指示に明記している。他のタスクの記述では代替できない。このタスクの指示に、要求される制約と矛盾する操作（許可されていない権限の使用、原本への直接操作、必要な隔離や通信遮断の解除など）が含まれる場合は、他に安全な記述があってもmissingとする（矛盾する操作の有無を安全な記述より優先して判定する）。このタスクの性質上、安全対策が不要な場合（検体へ直接操作しない報告・整理のみのタスクなど）はapplicableをfalseにする。", max: 8, core: true, scope: "step", allowNotApplicable: true },
      specific(3),
    ]),
    ...axis("verifiability", [
      { id: "fact-inference", label: "観測と推測の区別", description: "観測した挙動と、機能・意図についての推測を分けるよう指示している。", max: 5, core: true },
      { id: "evidence-ids", label: "根拠の識別情報", description: "オフセット、プロセス、通信先など、判断を元の観測へたどれる識別情報を記録させる。", max: 4 },
      COMPLETION_ITEM(5),
      { id: "corroboration", label: "複数証跡での裏付け", description: "静的・動的観測の照合や、別の手段での再確認を指示している。", max: 3 },
      specific(3),
    ]),
    ...axis("artifact", [
      { id: "observation-table", label: "観測結果の対応付け", description: "静的観測と動的観測の対応関係が分かる形式（表・箇条書き・チェックリストなど、形式は問わない）と、含めるべき項目（観測内容・根拠・一致か不一致かなど）を指定する。", max: 5 },
      { id: "preservation-record", label: "保全記録", description: "ハッシュ、取得日時、コピーの識別などの記録項目を指定する。", max: 4 },
      { id: "fact-separation", label: "事実・解釈・未確認事項の区別", description: "報告の中で事実・解釈・未確認事項を分けて書くよう指示している。", max: 4 },
      { id: "delivery", label: "追加確認と共有先", description: "安全な次の確認と、誰に渡すかを示す。", max: 3 },
      specific(4),
    ]),
  ]),
  vulnerability: rubric("vulnerability", "脆弱性調査", [
    { id: "scope", label: "対象と許可範囲の確定" },
    { id: "evidence", label: "設定・依存関係・入力検証・認可境界などの証拠収集" },
    { id: "impact", label: "成立条件と影響・優先度の評価" },
    { id: "remediation", label: "緩和策と修正後の再確認" },
  ], [
    { id: "configuration", label: "対象の構成・バージョン・依存関係" },
    { id: "boundary", label: "調査対象の境界（エンドポイント・ロール・テストアカウント）" },
    { id: "references", label: "参考情報（アドバイザリ・変更履歴など）" },
  ], "証拠収集と影響評価を同じタスクに混ぜない。実際の悪用や診断結果は求めない。", [
    ...axis("safety", [
      { id: "authorized-scope", label: "許可範囲への限定", description: "ローカルの検証用APIとテストアカウントなど、許可された対象だけに限定する。", max: 5, core: true },
      { id: "non-destructive", label: "非破壊・読み取り中心", description: "負荷試験、DoS、破壊的な入力、データ変更、実運用環境への接続を禁止している。", max: 5, core: true },
      { id: "out-of-scope-stop", label: "範囲外で止める条件と報告先", description: "想定外の応答や範囲外への到達で中断し、誰に判断を仰ぐかを示す。", max: 4 },
      { id: "secrets", label: "認証情報と秘密値の扱い", description: "見つけた秘密値を記録や共有に含めない具体策を示す。", max: 3 },
      specific(3),
    ]),
    ...axis("verifiability", [
      { id: "condition-evidence", label: "成立条件と証拠の対応付け", description: "どの設定・コード・応答が成立条件の根拠かをたどれるようにする。", max: 5, core: true },
      { id: "confidence", label: "確度の表示", description: "確認していない悪用の成功や被害を断定せず、確度を示すよう指示している。", max: 4 },
      COMPLETION_ITEM(5),
      { id: "recheck", label: "再確認の手順", description: "第三者が同じ確認をできる手順と、修正後の確認方法を示す。", max: 3 },
      specific(3),
    ]),
    ...axis("artifact", [
      { id: "memo-fields", label: "調査メモの必須項目", description: "対象、観測手順、取得元のわかる証拠を調査メモの項目として指定する。", max: 5 },
      { id: "impact-priority", label: "影響・優先度とその根拠", description: "影響・優先度と、その判断根拠を成果物に含めるよう指定する。", max: 4 },
      { id: "mitigation", label: "緩和策・推奨修正", description: "緩和策または推奨修正を成果物に含めるよう指定する。", max: 4 },
      { id: "delivery", label: "修正後の再確認条件と共有先", description: "修正後の再確認条件と、誰に渡すかを示す。", max: 3 },
      specific(4),
    ]),
  ]),
  logs: rubric("logs", "ログ解析", [
    { id: "integrity", label: "期間・時刻・欠損・重複などの前提確認" },
    { id: "timeline", label: "識別子ごとのイベントの時系列化" },
    { id: "hypotheses", label: "異常候補の根拠と別の説明の検討" },
    { id: "initial-response", label: "承認事項を含む初動メモ" },
  ], [
    { id: "source", label: "ログの出所・期間・タイムゾーン" },
    { id: "format", label: "形式とフィールドの定義" },
    { id: "anonymization", label: "匿名化規則と欠損の扱い" },
  ], "時系列化と仮説の判断を同じタスクに混ぜない。実際の異常検出結果は求めない。", [
    ...axis("safety", [
      { id: "read-only", label: "読み取りのみ・原本の保全", description: "提供されたログの読み取りだけに限定し、原本を変更しない。", max: 5, core: true },
      { id: "no-reidentification", label: "匿名値の復元・照合の禁止", description: "匿名化された値を復元したり、実在のユーザーと照合したりしない。", max: 4, core: true },
      { id: "approval", label: "変更操作を承認事項にする", description: "アカウント停止や設定変更は提案にとどめ、承認者を示す。", max: 4 },
      { id: "stop", label: "停止条件", description: "実在の個人情報や秘密値を見つけた場合に中断し、報告する。", max: 4 },
      specific(3),
    ]),
    ...axis("verifiability", [
      { id: "log-evidence", label: "根拠のログ行への対応付け", description: "タイムスタンプや識別子で、判断の根拠となるログ行をたどれるようにする。", max: 6, core: true },
      { id: "alternatives", label: "正常な別の説明との比較", description: "異常候補について、正常な利用などの別の説明と比較するよう指示している。", max: 4 },
      COMPLETION_ITEM(5),
      { id: "gaps", label: "欠損による結論の限界", description: "欠損や未取得の期間が結論にどう影響するかを示させる。", max: 2 },
      specific(3),
    ]),
    ...axis("artifact", [
      { id: "timeline-table", label: "時系列表の形式と必須列", description: "時系列表の形式と必須列を指定する。", max: 5 },
      { id: "candidates", label: "異常候補の一覧", description: "異常候補を、根拠と確度を含む一覧にするよう指定する。", max: 4 },
      { id: "fact-separation", label: "事実・推測・未確認事項の区別", description: "成果物の中で事実・推測・未確認事項を分けるよう指示している。", max: 3 },
      { id: "initial-memo", label: "初動メモ", description: "保全する証拠、承認が必要な対応、共有先を初動メモに含める。", max: 4 },
      specific(4),
    ]),
  ]),
  "incident-response": rubric("incident-response", "インシデント対応", [
    { id: "triage", label: "検知内容の確認とトリアージ" },
    { id: "preservation", label: "証拠保全" },
    { id: "scoping", label: "影響範囲の切り分け" },
    { id: "handoff", label: "対応案と引き継ぎ" },
  ], [
    { id: "assets", label: "対象資産と事業影響" },
    { id: "detection", label: "検知情報と利用できる証跡" },
    { id: "team", label: "体制（担当者・判断者・判断期限）" },
  ], "証拠保全を封じ込めなどの変更作業より前に置く。", [
    ...axis("safety", [
      { id: "change-approval", label: "封じ込め・復旧の変更は承認制", description: "封じ込めや復旧の変更を、承認を得てから行う計画として扱う。", max: 5, core: true },
      { id: "evidence-first", label: "証拠保全の優先", description: "変更前に証拠を取得し、揮発性の高い順に保全する。", max: 4, core: true },
      { id: "rollback", label: "ロールバックとエスカレーション条件", description: "変更のロールバック方法と、エスカレーションする条件を示す。", max: 4 },
      { id: "sharing", label: "共有範囲と機密の扱い", description: "攻撃者に察知されない配慮と、共有先の限定を示す。", max: 4 },
      specific(3),
    ]),
    ...axis("verifiability", [
      { id: "hypothesis-evidence", label: "侵害の仮説と証跡の照合", description: "侵害の仮説を具体的な証跡と照合するよう指示している。", max: 5, core: true },
      { id: "confidence", label: "確定・推定・未確認の区別", description: "確定・推定・未確認を分けて扱うよう指示している。", max: 4 },
      COMPLETION_ITEM(5),
      { id: "post-check", label: "対応後の確認", description: "封じ込めの効果と、再発の監視方法を示す。", max: 3 },
      specific(3),
    ]),
    ...axis("artifact", [
      { id: "status-report", label: "状況報告の必須項目", description: "時系列、影響、優先度を状況報告の項目として指定する。", max: 5 },
      { id: "rationale", label: "判断根拠と残る不確実性", description: "判断根拠と残る不確実性を成果物に含めるよう指定する。", max: 4 },
      { id: "handover", label: "引き継ぎ", description: "誰に何を渡し、何を判断してもらうかを示す。", max: 4 },
      { id: "next-actions", label: "次の対応案と承認事項", description: "次の対応案と、そのうち承認が必要な事項を示す。", max: 3 },
      specific(4),
    ]),
  ]),
  other: rubric("other", "その他", [
    { id: "premise", label: "入力と前提の確認" },
    { id: "main", label: "目的に必要な主作業" },
    { id: "verification", label: "結果の検証" },
    { id: "report", label: "成果物の作成と引き継ぎ" },
  ], [
    { id: "goal-scope", label: "目的・環境・対象範囲" },
  ], "", [
    ...axis("safety", [
      { id: "boundaries", label: "許可範囲と禁止操作", description: "演習の許可範囲と禁止操作、安全な代替手段を明記する。『安全に』という標語だけでは充足しない。", max: 6, core: true },
      { id: "privacy", label: "情報保護・原本を変えないこと", description: "原本を変更しない取り扱いと、秘密値・個人情報を記録や共有に含めない具体策を示す。", max: 4 },
      { id: "stop", label: "停止条件と判断者", description: "中断する具体的条件、中断する作業、再開判断を委ねる相手を示す。", max: 4 },
      specific(6),
    ]),
    ...axis("verifiability", [
      COMPLETION_ITEM(6, true),
      { id: "trace", label: "根拠と再確認の方法", description: "判断を元のデータに対応付ける識別情報と、再確認の方法を示す。", max: 5 },
      { id: "uncertainty", label: "不確実性の区別", description: "観測事実・推測・未確認事項を分け、結論の限界を扱う。", max: 3 },
      specific(6),
    ]),
    ...axis("artifact", [
      { id: "outputs", label: "各タスクの成果物と形式", description: "このタスクが返す成果物と形式（表・チェックリスト・メモ等）を指定する。『結果を報告』だけでは充足しない。", max: 6, core: true, scope: "step" },
      { id: "fields", label: "成果物の必須項目", description: "目的に必要な報告項目を具体的に指定する。", max: 5 },
      { id: "delivery", label: "共有先と次の判断", description: "誰に何を渡し、どの判断につなげるかを示す。", max: 3 },
      specific(6),
    ]),
  ]),
  tutorial: rubric("tutorial", "例題", [
    { id: "check", label: "昨日と今日のファイル一覧の前提確認" },
    { id: "compare", label: "ファイル名で対応付けたバイト単位の差分比較" },
    { id: "report", label: "変更点と未確認事項の報告" },
  ], [
    { id: "lists", label: "昨日と今日の一覧・サイズの単位" },
  ], "分割数は固定しない。", [
    ...axis("safety", [
      { id: "boundaries", label: "読み取り専用と外部送信の禁止", description: "画面の架空データだけを読み取り専用で扱い、元データの変更・外部送信を禁止する。VMや検体の安全対策は不要。", max: 8, core: true },
      { id: "stop", label: "不足時の停止と確認先", description: "不足や不一致があれば停止し、誰に確認するかを示す。", max: 6 },
      specific(6),
    ]),
    ...axis("verifiability", [
      COMPLETION_ITEM(8, true),
      { id: "trace", label: "元の一覧との照合", description: "数値を元の一覧と照合するなど、再確認の方法を示す。", max: 6 },
      specific(6),
    ]),
    ...axis("artifact", [
      { id: "outputs", label: "各タスクの成果物と形式", description: "このタスクが返す成果物と形式を指定する。", max: 8, core: true, scope: "step" },
      { id: "fields", label: "差分表と報告の項目", description: "ファイル名、昨日と今日のサイズ、差分、事実・推測・未確認事項を分けた報告を指定する。", max: 6 },
      specific(6),
    ]),
  ]),
};

/** 既定の「問題固有の観点」。自作問題の評価観点が空欄のときと、編集画面の初期値に使う。 */
export const DEFAULT_SPECIFIC_CRITERIA: Record<RubricTypeId, Record<CriterionId, string>> = {
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
  tutorial: {
    granularity: "確認・比較・報告の役割を分け、前段の成果物を次に渡す。",
    context: "昨日と今日の一覧、サイズの単位、前段の差分表を入力として示す。",
    safety: "架空データだけを読み取り専用で扱い、外部送信しない。",
    verifiability: "件数や数値を元の一覧と照合する完了条件を置く。",
    artifact: "差分表と、事実・推測・未確認事項を分けた報告の形式を指定する。",
  },
};

/** 標準演習の「問題固有の観点」。問題文に合わせた要件で、自作問題では利用者の評価観点に置き換わる。 */
export const SCENARIO_SPECIFIC_CRITERIA: Record<"malware" | "vulnerability" | "logs", Record<CriterionId, string>> = {
  malware: {
    granularity: "動的観測を条件付きで保留する場合も、承認条件・観測項目・手順の設計を独立したタスクとして含める。",
    context: "sample.exe の配置場所、スナップショット取得済みの使い捨てVM、ネットワーク遮断済みであることを渡す。",
    safety: "スナップショットからのロールバック方法と、動的観測を始める前の停止条件を先に示す。",
    verifiability: "ハッシュだけで悪性と断定せず、未知の文字列を通信先や機能と推測しない。",
    artifact: "報告書は教育用の判定として、機密値を伏せ字にし、現実の環境への適用手順を含めない。",
  },
  vulnerability: {
    granularity: "悪用手順ではなく、防御側の対策（入力制限・権限分離・監視）の検討を含める。",
    context: "対象がローカルの架空サービスで、最小権限のテストアカウントと監査ログが使えることを渡す。",
    safety: "スナップショットへ戻せる前提でも、検証を続ける前に承認・バックアップ・停止条件を確認する。",
    verifiability: "未確認の攻撃成功や被害を仮説としてラベル付けし、修正後に同じ非破壊チェックで再評価する。",
    artifact: "メモはテスト環境の識別子だけを使い、第三者が安全にレビューできる形式にする。",
  },
  logs: {
    granularity: "匿名化識別子ごとの成功・失敗・多要素認証・セッション終了の整理を独立した工程にする。",
    context: "ログは時刻を統一した架空システムの匿名化ログで、個人名・IP・トークンは置換済みであることを渡す。",
    safety: "アカウント停止などの初動は提案と承認依頼にとどめ、実環境へのアクセス権がない前提を守る。",
    verifiability: "認証成功だけで正当性や侵害を断定せず、根拠のない閾値を新設しない。",
    artifact: "初動メモに、保全する証拠と承認が必要な次の対応を分けて記載する。",
  },
};

export function rubricTypeFor(scenarioId: RubricScenarioId, domain?: TaskType): RubricTypeId {
  if (scenarioId === "custom") return domain ?? "other";
  return scenarioId;
}

export function rubricFor(typeId: RubricTypeId): TaskTypeRubric {
  return RUBRICS[typeId];
}

export function planItems(definition: TaskTypeRubric): RubricItem[] {
  return definition.items.filter((item) => item.scope === "plan");
}

export function stepItems(definition: TaskTypeRubric): RubricItem[] {
  return definition.items.filter((item) => item.scope === "step");
}


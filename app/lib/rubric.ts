import type { EvaluationProfile } from "./exercises";

export type RubricScenarioId = "malware" | "vulnerability" | "logs" | "tutorial";
export type CriterionId = "granularity" | "context" | "safety" | "verifiability" | "artifact";

export type RubricItem = {
  id: string;
  criterion: CriterionId;
  label: string;
  description: string;
  max: number;
  required: boolean;
  allSteps?: boolean;
};

export const RUBRIC_VERSION = "2026-09-26.1";
export const PASS_SCORE = 80;
export const AXIS_MINIMUM = 12;
export const STATUS_LABELS = { met: "充足", partial: "一部・抽象的", missing: "未充足" } as const;

const COMMON_ITEMS: RubricItem[] = [
  { id: "coverage", criterion: "granularity", label: "必要な工程の網羅", description: "演習固有の主要工程を、目的を達成できる作業としてすべて含める。工程名だけでは充足しない。後段が参照する成果物は、その生成・確認を行う具体的な指示が必要。存在しない前段の成果物への参照は工程の網羅と認めない。", max: 8, required: true },
  { id: "focus", criterion: "granularity", label: "各タスクの判断単位", description: "すべてのタスクに具体的な操作・確認観点と一つの主目的がある。『解析する』『確認する』だけ、無関係な作業、複数の独立した判断を丸投げする指示は充足しない。", max: 8, required: true, allSteps: true },
  { id: "flow", criterion: "granularity", label: "順序と受け渡し", description: "依存する作業の順序が妥当で、前段のどの出力を次段が利用するか明記する。番号を付けただけでは充足しない。", max: 4, required: false },
  { id: "inputs", criterion: "context", label: "対象と入力の特定", description: "すべてのタスクで、対象・使用するデータや資料、または前段の特定の成果物を示す。『必要な情報』『前の結果』だけでは充足しない。", max: 8, required: true, allSteps: true },
  { id: "scope", criterion: "context", label: "目的・前提・許可範囲", description: "演習の目的、利用できる環境と権限、対象範囲を回答本文で特定し、全タスクに適用されることを示す。設問に書かれた前提だけを回答の記述として評価しない。", max: 8, required: true },
  { id: "missing-input", criterion: "context", label: "情報不足への対応", description: "不足・欠損・未確認の入力を推測で補わず、何を確認して誰に照会するか、またはどの作業を保留するか示す。「未確認と表示する」だけでは対応方法がなくpartial。", max: 4, required: false },
  { id: "boundaries", criterion: "safety", label: "安全境界の具体化", description: "演習固有の禁止操作と安全な代替手段を明記し、全タスクで守る。『安全に』『最小権限で』という標語だけでは充足しない。", max: 8, required: true },
  { id: "privacy", criterion: "safety", label: "機密・原本の保護", description: "原本を変更しない取り扱いと、秘密値・個人情報を記録や共有に含めない具体策を示す。演習で機密値を扱わない場合は、架空データだけを使い外部送信しない旨でよい。", max: 8, required: false },
  { id: "stop", criterion: "safety", label: "停止条件と判断者", description: "次の3要素をすべて明示する：(1)前提不足・秘密値発見・想定外の影響など作業を中断する具体的な発生条件、(2)その場合に中断・保留する作業、(3)停止後に確認・再開判断を委ねる相手。通常の追加調査に承認が必要、断定を避ける、禁止操作をしない、という記述だけではmetにしない。", max: 4, required: true },
  { id: "acceptance", criterion: "verifiability", label: "各タスクの完了条件", description: "すべてのタスクに、第三者が確認できる完了条件を記す。対象件数・照合条件・必須項目の充足など、作業に即した条件を使う。『完了したら終了』は不可。", max: 8, required: true, allSteps: true },
  { id: "trace", criterion: "verifiability", label: "根拠と再確認方法", description: "判断を元の観測・データに対応付ける識別情報と、その根拠を照合・再確認する方法を示す。『根拠を付ける』だけでは充足しない。", max: 8, required: true },
  { id: "uncertainty", criterion: "verifiability", label: "不確実性と別の説明", description: "観測事実・推測・未確認事項を分け、結論の限界や代替仮説を扱う。架空の観測結果を事実として創作しない。", max: 4, required: false },
  { id: "outputs", criterion: "artifact", label: "各タスクの成果物", description: "すべてのタスクで、返す成果物と形式（表・チェックリスト・メモ等）を指定する。『結果を報告』だけでは充足しない。", max: 8, required: true, allSteps: true },
  { id: "fields", criterion: "artifact", label: "成果物の必須項目", description: "演習固有の報告項目を具体的に指定し、目的に必要な内容を網羅する。見出し名の羅列だけで作業指示がなければ充足しない。", max: 8, required: true },
  { id: "delivery", criterion: "artifact", label: "共有先と次の判断", description: "誰に何を渡し、どの判断や安全な追加確認につなげるか示す。実在の保存パスや人物名は不要。", max: 4, required: false },
];

const SCENARIO_REQUIREMENTS: Record<RubricScenarioId, { coverage: string; boundaries: string; fields: string }> = {
  malware: {
    coverage: "検体・証跡の保全、実行しない静的確認、隔離環境での動的観測の設計、静的・動的観測を結び付ける報告を含める。動的観測を条件付きで保留する場合も、承認条件・観測項目・手順の設計は必要。実際の実行や分析結果は求めない。",
    boundaries: "外部通信を遮断した使い捨てVM・解析用コピー・非管理者権限での観測を設計し、本番やホストでの検体実行、破壊的操作、外部への検体送信を禁止する。",
    fields: "保全情報、静的・動的の観測とその対応、根拠、事実・解釈・未確認事項、安全な追加確認を最終報告に含めるよう指示する。",
  },
  vulnerability: {
    coverage: "対象と許可範囲の確定、設定・依存関係・入力検証・認可境界などの証拠収集、成立条件と影響・優先度・緩和策の評価、再確認できる調査メモを含める。実際の悪用や診断結果は求めない。",
    boundaries: "ローカルの検証用APIとテストアカウントに限定し、読み取り中心とする。負荷試験・DoS・破壊的入力・データ変更・実運用環境への接続を禁止する。",
    fields: "対象、許可範囲、観測手順、取得元の分かる証拠、成立条件、影響・優先度、限界、緩和策・推奨修正、修正後の再確認条件を指定する。",
  },
  logs: {
    coverage: "ログの期間・時刻・欠損・重複等の前提確認、匿名化識別子ごとの認証イベントの時系列化、異常候補の根拠と別の説明の検討、承認を含む初動メモを含める。実際の異常検出結果は求めない。",
    boundaries: "提供された匿名化ログの読み取りだけに限定し、匿名値の復元・実ユーザーへの照合、アカウント停止、設定変更、実環境へのアクセスを禁止する。",
    fields: "観測期間、主要事実、異常候補と根拠、別の説明・未確認事項、影響・優先度、保全する証拠、承認が必要な次の対応を指定する。",
  },
  tutorial: {
    coverage: "昨日と今日のファイル一覧の前提確認、ファイル名で対応付けたバイト単位の差分比較、変更点と未確認事項の報告を含める。分割数は固定しない。",
    boundaries: "画面の架空データだけを読み取り専用で扱い、元データの変更・実ファイルへのアクセス・外部送信を禁止する。VMや検体の安全対策は不要。",
    fields: "ファイル名、昨日と今日のサイズ、差分の表、および事実・推測・未確認事項を分けた報告を指定する。",
  },
};

export function rubricFor(scenarioId: RubricScenarioId): RubricItem[] {
  return COMMON_ITEMS.map((item) => ({
    ...item,
    description: item.id in SCENARIO_REQUIREMENTS[scenarioId]
      ? `${item.description} ${SCENARIO_REQUIREMENTS[scenarioId][item.id as "coverage" | "boundaries" | "fields"]}`
      : item.description,
  }));
}

/** Apply an author's focus to the corresponding shared rubric items. */
export function rubricForCustom(profile: EvaluationProfile): RubricItem[] {
  const focusItem: Record<CriterionId, string> = {
    granularity: "coverage", context: "scope", safety: "boundaries",
    verifiability: "trace", artifact: "fields",
  };
  return COMMON_ITEMS.map((item) => ({
    ...item,
    description: item.id === focusItem[item.criterion] && profile.focus[item.criterion]
      ? `${item.description} この問題の確認観点: ${profile.focus[item.criterion]}`
      : item.description,
  }));
}

export const PENALTY_SPECS = [
  { id: "unsafe", label: "禁止操作・権限逸脱", points: 25, cap: 29, description: "演習で禁止した操作を実行する指示。禁止・否定・引用例は該当しない。" },
  { id: "contradiction", label: "指示間の矛盾", points: 15, cap: 79, description: "同時に守れない相反する指示。矛盾する両方の箇所を引用する。同じ違反をunsafeと重複計上しない。" },
  { id: "fabrication", label: "未確認事項の断定", points: 10, cap: 79, description: "観測していない結果を事実として創作・断定する指示。仮説や例示は該当しない。" },
  { id: "padding", label: "重複・無関係な水増し", points: 5, cap: 100, description: "同じ作業を役割なく繰り返す、または課題に無関係なタスクを加える。全体に適用する制約の再掲や必要な再確認は該当しない。" },
] as const;

export const SCORING_GUIDE = "各項目は未充足0%、一部・抽象的25%、具体的に充足100%で加点します。必須項目が未充足なら最大59点、一部なら最大79点。禁止操作は最大29点。合格には80点以上・必須項目すべて充足・各軸12点以上が必要です。未記載を二重に減点しません。";

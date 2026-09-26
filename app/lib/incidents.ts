import type { EvaluationCriterionId } from "./evaluator";

export type IncidentReference = {
  id: string;
  title: string;
  source: string;
  published: string;
  url: string;
  summary: string;
  lessons: { criterion: EvaluationCriterionId; description: string }[];
};

// Historical teaching summaries. Lessons are our educational interpretation,
// not quotations or current remediation instructions from the linked reports.
export const INCIDENT_REFERENCES: IncidentReference[] = [
  {
    id: "solarwinds-2020",
    title: "SolarWinds Orion のサプライチェーン侵害（2020年）",
    source: "CISA / AA20-352A",
    published: "2020-12-17",
    url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a",
    summary: "SolarWinds Orion のソフトウェアを経由した侵害が報告されました。CISA は、Orion 以外の初期侵入経路も調査対象としています。",
    lessons: [
      { criterion: "context", description: "教材の製品・更新履歴・権限・取得元を整理し、既知の侵入経路だけに調査対象を限定しない。" },
      { criterion: "verifiability", description: "正規の更新や署名だけを安全性の根拠にせず、複数の独立した証跡と照合し、確認済みの範囲を示す。" },
      { criterion: "artifact", description: "影響範囲、証拠の出所、未確認の侵入経路を分けた調査メモを成果物に含める。" },
    ],
  },
  {
    id: "log4shell-2021",
    title: "Log4Shell の悪用（2021年）",
    source: "CISA / AA21-356A",
    published: "2021-12-22",
    url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a",
    summary: "Log4j の脆弱性が悪用され、CISA 等は影響資産の特定、更新、侵害の調査を案内しました。スキャンの観測と悪用成功の兆候を区別する必要があります。",
    lessons: [
      { criterion: "granularity", description: "影響する依存関係の特定、悪用の証拠確認、緩和案と再確認を別の判断単位に分ける。" },
      { criterion: "context", description: "直接・間接の依存関係、教材のバージョン情報、公開範囲、利用可能なログを前提として渡す。" },
      { criterion: "verifiability", description: "スキャンや不審な入力だけで侵害を断定せず、成功を示す証跡と別の説明を検討する。" },
    ],
  },
  {
    id: "storm-0558-2023",
    title: "Storm-0558 によるメールへの不正アクセス（2023年）",
    source: "Microsoft Security",
    published: "2023-07-14",
    url: "https://www.microsoft.com/en-us/security/blog/2023/07/14/analysis-of-storm-0558-techniques-for-unauthorized-email-access/",
    summary: "Microsoft は、偽造された認証トークンによるメールへの不正アクセスを報告しました。顧客からの異常な Exchange Online データアクセスの報告が調査の契機となりました。",
    lessons: [
      { criterion: "context", description: "認証の成否だけでなく、データへのアクセス記録、収集可能な監査イベント、保持期間と欠損を確認する。" },
      { criterion: "verifiability", description: "認証成功を正当性の証明とせず、時刻・セッション・アクセス対象を照合し、異常と正当利用の仮説を比較する。" },
      { criterion: "safety", description: "トークンやメール本文を取得・外部送信せず、匿名化した識別子と必要最小限のメタデータで調査を設計する。" },
    ],
  },
];

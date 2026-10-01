import type { AnalysisStep } from "./evaluator";
import type { EvaluationProfile } from "./exercises";

export type ScenarioId = "malware" | "vulnerability" | "logs" | `custom-${string}`;

export type Scenario = {
  id: ScenarioId;
  eyebrow: string;
  title: string;
  description: string;
  goal: string;
  environment: string;
  riskLabel: string;
  duration: string;
  initialSteps: AnalysisStep[];
  materials?: string;
  evaluationProfile?: EvaluationProfile;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "malware",
    eyebrow: "検体解析",
    title: "sample.exe の安全な解析方針",
    description:
      "架空の検体を隔離したラボで調べ、静的情報と動作観測を結び付けます。",
    goal:
      "外部に影響を与えず、観測事実・推測・次の確認事項を分けた解析計画を作る。",
    environment:
      "ネットワーク遮断済みの使い捨て仮想マシン。検体は架空の sample.exe、権限は最小限、スナップショットを取得済み。",
    riskLabel: "高リスク",
    duration: "15分",
    initialSteps: [
      {
        id: "malware-preserve",
        title: "検体と証拠を保全する",
        instruction:
          "検体について確認してください。",
        context:
          "隔離ラボの sample.exe を対象にし、原本は変更しないでください。",
      },
      {
        id: "malware-static",
        title: "静的解析の観点を整理する",
        instruction:
          "実行せずにファイルの特徴を調べてください。",
        context:
          "外部通信のない端末で確認します。結果を断定しないでください。",
      },
      {
        id: "malware-dynamic",
        title: "動的観測を最小リスクで設計する",
        instruction:
          "動作確認の方針を考えてください。",
        context:
          "ダミーデータを使い、ネットワークは遮断します。想定外の挙動なら中断します。",
      },
      {
        id: "malware-assessment",
        title: "観測結果と不確実性を報告する",
        instruction:
          "観測結果をまとめてください。",
        context:
          "機密値は伏せ、未確認の内容を断定しないでください。",
      },
    ],
  },
  {
    id: "vulnerability",
    eyebrow: "脆弱性調査",
    title: "検証用サービスのリスクを見極める",
    description:
      "架空のテストサービスを対象に、影響範囲と再現条件を安全に整理します。",
    goal:
      "攻撃を成立させるのではなく、証拠に基づき優先度・緩和策・追加確認を説明する。",
    environment:
      "ローカル専用の検証用 API とサンプルデータ。外部公開なし、最小権限のテストアカウント、監査ログ有効。",
    riskLabel: "中リスク",
    duration: "12分",
    initialSteps: [
      {
        id: "vulnerability-scope",
        title: "対象と許可範囲を確定する",
        instruction:
          "対象となる API を確認してください。",
        context:
          "ローカル環境だけを対象にします。",
      },
      {
        id: "vulnerability-evidence",
        title: "安全な証拠を集める",
        instruction:
          "資料を確認してください。",
        context:
          "負荷試験、データ変更、実環境への接続は禁止です。",
      },
      {
        id: "vulnerability-impact",
        title: "影響と優先度を評価する",
        instruction:
          "気になる点を整理してください。",
        context:
          "未確認の内容は断定しないでください。",
      },
      {
        id: "vulnerability-report",
        title: "再現性のある調査メモにする",
        instruction:
          "結果を簡単にまとめてください。",
        context:
          "機密情報は載せず、変更操作はしないでください。",
      },
    ],
  },
  {
    id: "logs",
    eyebrow: "ログ解析",
    title: "認証ログから異常の兆候を読む",
    description:
      "匿名化された認証ログを時系列で確認し、事実に基づく初動案を組み立てます。",
    goal:
      "個人や正当な利用を決めつけず、異常の根拠・不確実性・安全な追加調査を示す。",
    environment:
      "時刻を統一した架空システムの匿名化ログ。個人名・IP・トークンは置換済みで、実環境へのアクセス権はありません。",
    riskLabel: "低リスク",
    duration: "10分",
    initialSteps: [
      {
        id: "logs-integrity",
        title: "ログの完全性と前提を確認する",
        instruction:
          "匿名化された認証ログの期間と欠損を確認してください。",
        context:
          "原本を変更せず、匿名値から個人を特定しないでください。",
      },
      {
        id: "logs-timeline",
        title: "認証イベントを時系列化する",
        instruction:
          "認証イベントを時刻順に整理してください。",
        context:
          "時刻のずれに注意してください。",
      },
      {
        id: "logs-triage",
        title: "異常候補を安全に切り分ける",
        instruction:
          "異常候補を挙げて、別の説明も考えてください。",
        context:
          "実環境の操作や認証情報の取得は行いません。",
      },
      {
        id: "logs-report",
        title: "初動メモと次の安全な一手を作る",
        instruction:
          "結果を初動メモにまとめてください。",
        context:
          "匿名化を維持し、変更操作は実行しないでください。",
      },
    ],
  },
];

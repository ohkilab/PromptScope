/**
 * A plan step supplied by the client-side trainer.
 *
 * The evaluator intentionally does not make any assumptions about where a
 * step came from.  In particular, `context` is kept separate from the
 * instruction so that the caller can use it as the user's evidence/scope
 * field while still passing a small, serialisable object around.
 */
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

export type EvaluationCriterion = {
  id: EvaluationCriterionId;
  label: string;
  score: number;
  max: number;
  message: string;
  stepDetails?: EvaluationStepDetail[];
};

export type EvaluationStepDetail = {
  stepId: string;
  stepNumber: number;
  title: string;
  score: number;
  max: number;
  message: string;
};

export type EvaluationResult = {
  criteria: EvaluationCriterion[];
  strengths: string[];
  improvements: string[];
  total: number;
};

type CriterionSpec = {
  id: EvaluationCriterionId;
  label: string;
  max: number;
};

type NormalizedStep = {
  id: string;
  title: string;
  instruction: string;
  context: string;
  text: string;
  hasMeaningfulTitle: boolean;
  hasSubstantiveInstruction: boolean;
  hasSubstantiveContext: boolean;
  actionCount: number;
};

type PlanSnapshot = {
  title: string;
  steps: NormalizedStep[];
  text: string;
  authoredText: string;
  nonEmptySteps: NormalizedStep[];
  hasRepeatedStepIds: boolean;
};

type SafetyRisks = {
  productionExecution: boolean;
  externalTransfer: boolean;
  credentialExposure: boolean;
  specimenExecution: boolean;
  privilegeEscalation: boolean;
  controlBypass: boolean;
  destructiveChange: boolean;
};

type ContextSignals = {
  target: boolean;
  purpose: boolean;
  inputEvidence: boolean;
  scopeConstraints: boolean;
};

const CRITERIA: readonly CriterionSpec[] = [
  { id: "granularity", label: "分割粒度", max: 20 },
  { id: "context", label: "コンテキスト充足", max: 20 },
  { id: "safety", label: "安全性・権限境界", max: 20 },
  { id: "verifiability", label: "検証可能性", max: 20 },
  { id: "artifact", label: "成果物の明確さ", max: 20 },
] as const;

const EMPTY_PLAN_MESSAGE = "情報がありません。対象・目的・手順を追加してください。";

/*
 * These expressions deliberately favour plain Japanese words.  The product
 * is a writing trainer rather than a security scanner, so a false negative
 * here is preferable to pretending that a vague sentence is a complete
 * security control.  Dangerous phrases have their own, stricter expressions
 * below and are handled independently.
 */
const TARGET_PATTERNS: readonly RegExp[] = [
  /分析対象|調査対象|対象(?:システム|データ|ログ|ファイル|コード|サービス)?/i,
  /検体|マルウェア|脆弱性|インシデント|アラート|イベント/i,
  /ログ|コード|ファイル|リポジトリ|サーバー?|端末|ネットワーク|API|URL|データベース|クラウド/i,
];

const EXPLICIT_PURPOSE_PATTERNS: readonly RegExp[] = [
  /目的|狙い|ゴール|達成条件|何を(?:判定|特定|検出|明らかに|確認)/i,
  /(?:原因|影響|リスク|脆弱性|不審|侵害|異常|挙動)[^。.!?\n]{0,18}(?:調査|特定|検出|把握|判定|評価|確認)/i,
  /(?:調査|特定|検出|把握|判定|評価|確認)[^。.!?\n]{0,18}(?:原因|影響|リスク|脆弱性|不審|侵害|異常|挙動)/i,
];

const EXPLICIT_INPUT_PATTERNS: readonly RegExp[] = [
  /入力|インプット|証跡|根拠|サンプル|検体|リクエスト|トレース|キャプチャ/i,
  /メタデータ|ハッシュ|バージョン|環境情報|チケット|アラート|観測|収集|取得|提供/i,
  /(?:ログ|データ|ファイル)[^。.!?\n]{0,14}(?:対象|入力|取得|提供|収集|解析|分析)/i,
];

const CONSTRAINT_PATTERNS: readonly RegExp[] = [
  /制約|前提|範囲|スコープ|期限|時間|対象外|禁止|不可|避け|許可|承認/i,
  /読み取り専用|read[- ]?only|変更しない|削除しない|上書きしない/i,
  /レート|負荷|回数|タイムアウト|上限|中止条件|停止条件/i,
];

const ARTIFACT_OUTPUT_PATTERNS: readonly RegExp[] = [
  /成果物|出力|報告書|レポート|所見|推奨|チケット|一覧|表形式|提出先|保存先/i,
  /(?:記録|ログ|結果)[^。.!?\n]{0,12}(?:保存|提出|出力|報告|共有)/i,
];

const VERIFICATION_CRITERIA_PATTERN =
  /成功条件|判定基準|期待値|合格条件|失敗条件|完了条件/i;

const VERIFICATION_EVIDENCE_PATTERN =
  /証跡|差分|スクリーンショット|チェック結果|(?:ログ|結果)[^。.!?\n]{0,12}(?:保存|記録|提出|出力|比較)/i;

const VERIFICATION_CHECK_PATTERN =
  /検証|再現|再実行|テスト|チェックポイント|レビュー|照合|ロールバック/i;

const FORMAT_PATTERNS: readonly RegExp[] = [
  /形式|フォーマット|テンプレート|スキーマ|項目|列|キー|必須項目|保存先|出力先/i,
  /json|csv|markdown|md|yaml|xml|表形式|箇条書き/i,
];

const ACTION_PATTERN =
  /確認|取得|抽出|収集|解析|分析|比較|分類|記録|生成|報告|検証|評価|特定|検出|整理|実行|送信|変更|削除|判定/gi;

const TITLE_ACTION_PATTERN =
  /確認|取得|抽出|収集|解析|分析|比較|分類|記録|生成|報告|検証|評価|特定|検出|整理|調査|作成|切り分け|洗い出し|仮説化/i;

const GENERIC_TITLE_PATTERN =
  /^(?:確認|調査|作業|対応|分析|解析|整理|判定|記録|報告|検証|タスク|手順|ステップ|todo|test|aaa|bbb|ccc)$/i;

const ISOLATION_PATTERNS: readonly RegExp[] = [
  /隔離|サンドボックス|sandbox|コンテナ|使い捨て|複製環境|専用環境/i,
  /ローカル|オフライン|テスト環境|検証環境|ステージング|スナップショット/i,
];

const PERMISSION_PATTERNS: readonly RegExp[] = [
  /最小権限|読み取り専用|read[- ]?only|権限(?:を|は)?(?:限定|制限)|許可された範囲/i,
  /ロール|スコープ|承認|管理者権限を付与しない|sudoを使わない/i,
];

const SECRET_PROTECTION_PATTERNS: readonly RegExp[] = [
  /マスキング|伏せ字|匿名化|秘匿|暗号化|機密情報を(?:含めない|除外|削除)/i,
  /資格情報を(?:貼らない|入力しない|共有しない|送信しない)|秘密情報を(?:貼らない|含めない|共有しない)/i,
  /個人情報を(?:除外|匿名化|マスキング|含めない)/i,
];

const BOUNDARY_PATTERNS: readonly RegExp[] = [
  /外部(?:送信|接続|公開|共有)しない|社外(?:送信|共有)しない|持ち出さない/i,
  /ネットワーク(?:を)?(?:遮断|制限)|外部接続(?:なし|禁止)|データ境界/i,
  /インターネット(?:に)?(?:接続しない|公開しない)/i,
];

const CHANGE_CONTROL_PATTERNS: readonly RegExp[] = [
  /非破壊|変更しない|削除しない|上書きしない|dry[- ]?run|ドライラン/i,
  /バックアップ|スナップショット|ロールバック|差分確認|復元/i,
];

const LIMIT_PATTERNS: readonly RegExp[] = [
  /停止条件|中止条件|承認|レビュー|タイムアウト|レート制限|負荷|上限/i,
  /操作前に確認|影響範囲|エスカレーション|緊急連絡/i,
];

const SENSITIVE_DATA_PATTERN =
  /資格情報|認証情報|パスワード|秘密情報|シークレット|APIキー|アクセストークン|秘密鍵|個人情報|個人データ|PII/i;

const NEGATION_BEFORE_PATTERN =
  /(?:禁止|厳禁|不可|避ける|避けて|行わない|しない|しません|含めない|貼らない|送らない|公開しない|実行しない)[\s、。,:：;・/]*$/;

const NEGATION_AFTER_PATTERN =
  /^\s*(?:しない|しません|しないこと|しないで|ない|ません|禁止|厳禁|不可|避ける|避けて|行わない|含めない|らない|りません|(?:は|を|の|するのは)\s*(?:禁止|厳禁|不可))/;

const UNSAFE_PATTERNS: Readonly<Record<keyof SafetyRisks, readonly RegExp[]>> = {
  productionExecution: [
    /本番(?:環境)?[^。.!?\n]{0,18}(?:実行|適用|投入|変更|削除|停止|再起動)/i,
    /(?:実行|適用|投入|変更|削除|停止|再起動)[^。.!?\n]{0,18}本番(?:環境)?/i,
  ],
  externalTransfer: [
    /(?:外部|第三者|社外|インターネット|公開先)[^。.!?\n]{0,18}(?:送信|アップロード|公開|共有|転送)/i,
    /(?:送信|アップロード|公開|共有|転送)[^。.!?\n]{0,18}(?:外部|第三者|社外|インターネット)/i,
  ],
  credentialExposure: [
    /(?:資格情報|認証情報|パスワード|APIキー|アクセストークン|トークン|秘密鍵|シークレット)[^。.!?\n]{0,18}(?:貼|入力|記載|共有|送信|公開)/i,
    /(?:貼|入力|記載|共有|送信|公開)[^。.!?\n]{0,18}(?:資格情報|認証情報|パスワード|APIキー|アクセストークン|トークン|秘密鍵|シークレット)/i,
  ],
  specimenExecution: [
    /(?:検体|マルウェア|不審な(?:ファイル|バイナリ)|ペイロード|未知のファイル)[^。.!?\n]{0,18}(?:直接|そのまま)?(?:実行|起動)/i,
    /(?:実行|起動)[^。.!?\n]{0,18}(?:検体|マルウェア|不審な(?:ファイル|バイナリ)|ペイロード)/i,
  ],
  privilegeEscalation: [
    /(?:root|sudo|管理者権限|全権限|特権)[^。.!?\n]{0,18}(?:で実行|付与|常用|要求|使用)/i,
    /(?:付与|要求|使用)[^。.!?\n]{0,18}(?:root|sudo|管理者権限|全権限|特権)/i,
  ],
  controlBypass: [
    /(?:認証|検知|検証|保護|サンドボックス|監査)[^。.!?\n]{0,14}(?:無効|回避|スキップ|無視)/i,
    /(?:無効|回避|スキップ|無視)[^。.!?\n]{0,14}(?:認証|検知|検証|保護|サンドボックス|監査)/i,
  ],
  destructiveChange: [
    /(?:削除|破壊|上書き|停止|再起動)[^。.!?\n]{0,14}(?:実行|行う|する|して)/i,
    /(?:実行|行う|する|して)[^。.!?\n]{0,14}(?:削除|破壊|上書き|停止|再起動)/i,
  ],
};

const RISK_PENALTIES: Readonly<Record<keyof SafetyRisks, number>> = {
  productionExecution: 9,
  externalTransfer: 7,
  credentialExposure: 10,
  specimenExecution: 10,
  privilegeEscalation: 7,
  controlBypass: 7,
  destructiveChange: 6,
};

const NEGATION_SAFE_PHRASES: readonly RegExp[] = [
  /本番(?:環境)?[^。.!?\n]{0,18}(?:実行|適用|投入|変更|削除|停止|再起動)(?:しない|しません|禁止|不可)/i,
  /(?:外部|第三者|社外|インターネット)[^。.!?\n]{0,18}(?:送信|アップロード|公開|共有|転送)(?:しない|しません|禁止|不可)/i,
  /(?:資格情報|認証情報|パスワード|APIキー|アクセストークン|トークン|秘密鍵|シークレット)[^。.!?\n]{0,18}(?:貼らない|入力しない|記載しない|共有しない|送信しない|公開しない)/i,
  /(?:検体|マルウェア|不審な(?:ファイル|バイナリ)|ペイロード|未知のファイル)[^。.!?\n]{0,18}(?:直接|そのまま)?(?:実行|起動)(?:しない|しません|禁止|不可)/i,
];

function normalizeText(value: string): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function includesAny(text: string, patterns: readonly RegExp[] | RegExp): boolean {
  const candidates = patterns instanceof RegExp ? [patterns] : patterns;
  return candidates.some((pattern) => pattern.test(text));
}

function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return text.match(new RegExp(pattern.source, flags))?.length ?? 0;
}

function hasJapaneseText(text: string): boolean {
  return /[ぁ-んァ-ン一-龯]/.test(text);
}

function hasContextSignal(text: string): boolean {
  return (
    includesAny(text, TARGET_PATTERNS) ||
    includesAny(text, EXPLICIT_PURPOSE_PATTERNS) ||
    includesAny(text, EXPLICIT_INPUT_PATTERNS) ||
    includesAny(text, CONSTRAINT_PATTERNS)
  );
}

function isMeaningfulTitle(text: string): boolean {
  return (
    text.length >= 4 &&
    hasJapaneseText(text) &&
    !GENERIC_TITLE_PATTERN.test(text) &&
    (TITLE_ACTION_PATTERN.test(text) || hasContextSignal(text))
  );
}

function isSubstantiveInstruction(text: string): boolean {
  return text.length >= 16 && hasJapaneseText(text) && countMatches(text, ACTION_PATTERN) > 0;
}

function isSubstantiveContext(text: string): boolean {
  return text.length >= 12 && hasJapaneseText(text) && hasContextSignal(text);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundedScore(value: number, max: number): number {
  return clamp(Math.round(value), 0, max);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function isNegatedMatch(text: string, matchIndex: number, matchLength: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 28), matchIndex);
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 16);
  return NEGATION_BEFORE_PATTERN.test(before) || NEGATION_AFTER_PATTERN.test(after);
}

function hasUnsafePattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    const match = pattern.exec(text);
    return Boolean(match) && !isNegatedMatch(text, match?.index ?? 0, match?.[0].length ?? 0);
  });
}

function detectSafetyRisks(text: string): SafetyRisks {
  const safeText = NEGATION_SAFE_PHRASES.reduce(
    (remaining, safePhrase) => remaining.replace(safePhrase, " "),
    text,
  );

  return {
    productionExecution: hasUnsafePattern(safeText, UNSAFE_PATTERNS.productionExecution),
    externalTransfer: hasUnsafePattern(safeText, UNSAFE_PATTERNS.externalTransfer),
    credentialExposure: hasUnsafePattern(safeText, UNSAFE_PATTERNS.credentialExposure),
    specimenExecution: hasUnsafePattern(safeText, UNSAFE_PATTERNS.specimenExecution),
    privilegeEscalation: hasUnsafePattern(safeText, UNSAFE_PATTERNS.privilegeEscalation),
    controlBypass: hasUnsafePattern(safeText, UNSAFE_PATTERNS.controlBypass),
    destructiveChange: hasUnsafePattern(safeText, UNSAFE_PATTERNS.destructiveChange),
  };
}

function hasRepeatedIds(steps: NormalizedStep[], source: AnalysisStep[]): boolean {
  const ids = source
    .map((step) => (typeof step?.id === "string" ? step.id.trim() : ""))
    .filter((id) => id.length > 0);
  return ids.length > new Set(ids).size || ids.length < steps.length;
}

function createSnapshot(taskTitle: string, steps: AnalysisStep[]): PlanSnapshot {
  const title = normalizeText(taskTitle);
  const sourceSteps = Array.isArray(steps) ? steps : [];
  const normalizedSteps = sourceSteps.map((step, index) => {
    const id = normalizeText(step?.id ?? "") || `step-${index + 1}`;
    const titleText = normalizeText(step?.title ?? "");
    const instruction = normalizeText(step?.instruction ?? "");
    const context = normalizeText(step?.context ?? "");
    const actionCount = countMatches(instruction, ACTION_PATTERN);
    return {
      id,
      title: titleText,
      instruction,
      context,
      text: [titleText, instruction, context].filter(Boolean).join(" "),
      hasMeaningfulTitle: isMeaningfulTitle(titleText),
      hasSubstantiveInstruction: isSubstantiveInstruction(instruction),
      hasSubstantiveContext: isSubstantiveContext(context),
      actionCount,
    };
  });
  const nonEmptySteps = normalizedSteps.filter((step) => step.text.length > 0);
  const meaningfulTitleText = normalizedSteps
    .filter((step) => step.hasMeaningfulTitle)
    .map((step) => step.title)
    .join(" ");
  const instructionText = normalizedSteps.map((step) => step.instruction).filter(Boolean).join(" ");
  const contextText = normalizedSteps.map((step) => step.context).filter(Boolean).join(" ");
  const authoredText = [meaningfulTitleText, instructionText, contextText].filter(Boolean).join(" ");
  const text = [title, ...normalizedSteps.map((step) => step.text)]
    .filter(Boolean)
    .join(" ");
  return {
    title,
    steps: normalizedSteps,
    text,
    authoredText,
    nonEmptySteps,
    hasRepeatedStepIds: hasRepeatedIds(normalizedSteps, sourceSteps),
  };
}

function detectContextSignals(snapshot: PlanSnapshot): ContextSignals {
  const text = snapshot.authoredText;
  return {
    target: includesAny(text, TARGET_PATTERNS),
    purpose: includesAny(text, EXPLICIT_PURPOSE_PATTERNS),
    inputEvidence: includesAny(text, EXPLICIT_INPUT_PATTERNS),
    scopeConstraints: includesAny(text, CONSTRAINT_PATTERNS),
  };
}

function scoreStepGranularity(step: NormalizedStep): number {
  if (step.text.length === 0) return 0;

  let score = 0;
  if (step.hasMeaningfulTitle) score += 4;
  else if (step.title.length > 0) score += 1;

  if (step.hasSubstantiveInstruction) score += 7;
  else if (step.instruction.length > 0) score += 2;

  if (step.instruction.length >= 30 && step.instruction.length <= 420) score += 3;
  else if (step.instruction.length >= 16 && step.instruction.length <= 600) score += 1;

  if (step.actionCount === 1) score += 5;
  else if (step.actionCount === 2) score += 4;
  else if (step.actionCount === 3) score += 3;
  else if (step.actionCount === 4) score += 1;

  return roundedScore(score, 20);
}

function granularityStepMessage(step: NormalizedStep, score: number): string {
  if (step.text.length === 0) return "タスク名とAgentへの指示を入力してください。";
  if (!step.hasMeaningfulTitle) return "タスク名を対象＋操作が分かる表現にしてください。";
  if (!step.hasSubstantiveInstruction) return "Agentへの指示を対象＋動詞で具体化してください。";
  if (step.actionCount > 4) return "操作を詰め込みすぎています。判断単位ごとに分割してください。";
  if (step.instruction.length > 420) return "指示が長めです。独立した判断単位に分割してください。";
  if (score >= 16) return "1つの判断単位として適切な粒度です。";
  return "対象と主操作を1つに絞ると、担当範囲が明確になります。";
}

function stepContextSignals(step: NormalizedStep): ContextSignals {
  const text = step.text;
  return {
    target: includesAny(text, TARGET_PATTERNS),
    purpose: includesAny(text, EXPLICIT_PURPOSE_PATTERNS),
    inputEvidence: includesAny(text, EXPLICIT_INPUT_PATTERNS),
    scopeConstraints: includesAny(text, CONSTRAINT_PATTERNS),
  };
}

function scoreStepContext(step: NormalizedStep): number {
  if (step.text.length === 0) return 0;

  const primaryText = [step.instruction, step.context].filter(Boolean).join(" ");
  const scoreSignal = (
    patterns: readonly RegExp[] | RegExp,
    fullScore: number,
    titleScore: number,
  ) => {
    if (includesAny(primaryText, patterns)) return fullScore;
    if (includesAny(step.title, patterns)) return titleScore;
    return 0;
  };

  let score = 0;
  score += scoreSignal(TARGET_PATTERNS, 4, 2);
  score += scoreSignal(EXPLICIT_PURPOSE_PATTERNS, 3, 1);
  score += scoreSignal(EXPLICIT_INPUT_PATTERNS, 4, 1);
  score += scoreSignal(CONSTRAINT_PATTERNS, 4, 0);
  if (step.hasSubstantiveContext) score += 5;
  else if (step.context.length > 0) score += 2;
  return roundedScore(score, 20);
}

function contextStepMessage(step: NormalizedStep, score: number): string {
  if (step.text.length === 0) return EMPTY_PLAN_MESSAGE;
  if (!step.hasSubstantiveContext) {
    return "渡すコンテキストに前段の結果・前提・制約を具体的に記載してください。";
  }

  const signals = stepContextSignals(step);
  const missing: string[] = [];
  if (!signals.target) missing.push("対象");
  if (!signals.purpose) missing.push("目的");
  if (!signals.inputEvidence) missing.push("入力・証跡");
  if (!signals.scopeConstraints) missing.push("範囲・制約");
  if (missing.length > 0) return `${missing.slice(0, 2).join("・")}を補ってください。`;
  if (score >= 16) return "対象・入力・前提・制約が揃っています。";
  return "このタスクだけで着手できるよう、前提をもう少し具体化してください。";
}

function createStepDetails(
  snapshot: PlanSnapshot,
  scoreStep: (step: NormalizedStep) => number,
  messageForStep: (step: NormalizedStep, score: number) => string,
): EvaluationStepDetail[] {
  return snapshot.steps.map((step, index) => {
    const score = scoreStep(step);
    return {
      stepId: step.id,
      stepNumber: index + 1,
      title: step.title || `分析タスク ${index + 1}`,
      score,
      max: 20,
      message: messageForStep(step, score),
    };
  });
}

function scoreGranularity(snapshot: PlanSnapshot, stepDetails: EvaluationStepDetail[]): number {
  const count = snapshot.steps.length;
  if (count === 0 || snapshot.nonEmptySteps.length === 0) return 0;

  const stepAverage = stepDetails.reduce((sum, detail) => sum + detail.score, 0) / count;
  let chainScore = 0;
  if (count === 1) chainScore = 6;
  else if (count <= 8) chainScore = 20;
  else if (count <= 12) chainScore = 12;
  else if (count <= 16) chainScore = 6;
  else chainScore = 2;
  if (snapshot.hasRepeatedStepIds) chainScore = Math.max(0, chainScore - 5);

  const chainWeight = Math.min(1, stepAverage / 4);
  return roundedScore(stepAverage * 0.8 + chainScore * 0.2 * chainWeight, 20);
}

function scoreContext(snapshot: PlanSnapshot, stepDetails: EvaluationStepDetail[]): number {
  if (snapshot.authoredText.length === 0 || stepDetails.length === 0) return 0;
  const average = stepDetails.reduce((sum, detail) => sum + detail.score, 0) / stepDetails.length;
  return roundedScore(average, 20);
}

function scoreSafety(snapshot: PlanSnapshot): number {
  if (snapshot.text.length === 0) return 0;

  let score = 4;
  if (includesAny(snapshot.text, ISOLATION_PATTERNS)) score += 4;
  if (includesAny(snapshot.text, PERMISSION_PATTERNS)) score += 3;
  if (includesAny(snapshot.text, SECRET_PROTECTION_PATTERNS)) score += 3;
  else if (SENSITIVE_DATA_PATTERN.test(snapshot.text)) score += 1;
  if (includesAny(snapshot.text, BOUNDARY_PATTERNS)) score += 2;
  if (includesAny(snapshot.text, CHANGE_CONTROL_PATTERNS)) score += 3;
  if (includesAny(snapshot.text, LIMIT_PATTERNS)) score += 1;

  const risks = detectSafetyRisks(snapshot.text);
  (Object.keys(risks) as (keyof SafetyRisks)[]).forEach((risk) => {
    if (risks[risk]) score -= RISK_PENALTIES[risk];
  });
  return roundedScore(score, 20);
}

function scoreVerifiability(snapshot: PlanSnapshot): number {
  if (snapshot.text.length === 0) return 0;

  let score = 0;
  if (VERIFICATION_CRITERIA_PATTERN.test(snapshot.text)) score += 7;
  if (VERIFICATION_EVIDENCE_PATTERN.test(snapshot.text)) score += 5;
  if (includesAny(snapshot.text, /再現|再実行|固定|バージョン|ハッシュ|タイムスタンプ/i)) {
    score += 4;
  }
  if (VERIFICATION_CHECK_PATTERN.test(snapshot.text)) score += 4;
  return roundedScore(score, 20);
}

function scoreArtifact(snapshot: PlanSnapshot): number {
  if (snapshot.text.length === 0) return 0;

  let score = 0;
  if (includesAny(snapshot.text, ARTIFACT_OUTPUT_PATTERNS)) score += 7;
  if (includesAny(snapshot.text, FORMAT_PATTERNS)) score += 6;
  if (includesAny(snapshot.text, /項目|スキーマ|列|キー|必須|保存先|出力先|担当|提出先/i)) {
    score += 4;
  }
  if (includesAny(snapshot.text, /報告|共有|提出|引き継ぎ|意思決定/i)) score += 3;
  return roundedScore(score, 20);
}

function weakestStep(stepDetails: EvaluationStepDetail[]): EvaluationStepDetail | undefined {
  return stepDetails.reduce<EvaluationStepDetail | undefined>(
    (weakest, detail) => (!weakest || detail.score < weakest.score ? detail : weakest),
    undefined,
  );
}

function granularityMessage(
  snapshot: PlanSnapshot,
  score: number,
  stepDetails: EvaluationStepDetail[],
): string {
  if (snapshot.steps.length === 0 || snapshot.nonEmptySteps.length === 0) {
    return "分析手順がありません。";
  }
  if (snapshot.steps.length === 1) {
    return "1ステップに集中しています。取得・解析・判定を分けてください。";
  }
  if (snapshot.steps.length > 12) {
    return "ステップが多めです。細かな操作を判断単位にまとめてください。";
  }
  const weakest = weakestStep(stepDetails);
  if (weakest && weakest.score < 16) {
    return `タスク${weakest.stepNumber}の粒度が全体評点を下げています。`;
  }
  if (score >= 16) return "手順数と各タスクの役割が整理されています。";
  return "手順を順序付きの判断単位に整えると再利用しやすくなります。";
}

function contextMessage(
  snapshot: PlanSnapshot,
  score: number,
  stepDetails: EvaluationStepDetail[],
): string {
  if (score === 0) return EMPTY_PLAN_MESSAGE;
  const weakest = weakestStep(stepDetails);
  if (weakest && weakest.score < 16) {
    return `タスク${weakest.stepNumber}のコンテキスト不足が全体評点を下げています。`;
  }
  if (snapshot.steps.length > 0 && score >= 16) {
    return "各タスクの対象・入力・前提・制約が具体的です。";
  }
  return "タスク別内訳を確認し、不足している前提を補ってください。";
}

function safetyMessage(snapshot: PlanSnapshot, score: number): string {
  if (snapshot.text.length === 0) return EMPTY_PLAN_MESSAGE;
  const risks = detectSafetyRisks(snapshot.text);
  const riskLabels: string[] = [];
  if (risks.productionExecution) riskLabels.push("本番操作");
  if (risks.externalTransfer) riskLabels.push("外部送信");
  if (risks.credentialExposure) riskLabels.push("資格情報の露出");
  if (risks.specimenExecution) riskLabels.push("検体の直接実行");
  if (risks.privilegeEscalation) riskLabels.push("過剰権限");
  if (risks.controlBypass) riskLabels.push("保護機構の回避");
  if (risks.destructiveChange) riskLabels.push("破壊的変更");
  if (riskLabels.length > 0) {
    return `${riskLabels.slice(0, 2).join("・")}を避け、隔離・承認条件を明記してください。`;
  }
  if (score >= 16) return "隔離・権限・機密情報の境界が明確です。";
  if (!includesAny(snapshot.text, ISOLATION_PATTERNS)) {
    return "隔離環境（サンドボックス等）を指定してください。";
  }
  if (!includesAny(snapshot.text, PERMISSION_PATTERNS)) {
    return "最小権限と読み取り専用の範囲を指定してください。";
  }
  return "機密情報の扱いと外部送信の境界を明記してください。";
}

function verifiabilityMessage(snapshot: PlanSnapshot, score: number): string {
  if (snapshot.text.length === 0) return EMPTY_PLAN_MESSAGE;
  if (!VERIFICATION_CRITERIA_PATTERN.test(snapshot.text)) {
    return "成功条件と期待値を追加してください。";
  }
  if (!VERIFICATION_EVIDENCE_PATTERN.test(snapshot.text)) {
    return "判定に使うログ・差分などの証跡を指定してください。";
  }
  if (score >= 16) return "成功条件と証跡があり、再確認しやすい構成です。";
  return "再現手順またはチェックポイントを追加してください。";
}

function artifactMessage(snapshot: PlanSnapshot, score: number): string {
  if (snapshot.text.length === 0) return EMPTY_PLAN_MESSAGE;
  if (!includesAny(snapshot.text, ARTIFACT_OUTPUT_PATTERNS)) {
    return "成果物（報告書・一覧など）を指定してください。";
  }
  if (!includesAny(snapshot.text, FORMAT_PATTERNS)) {
    return "出力形式と必須項目を指定してください。";
  }
  if (score >= 16) return "成果物の種類・形式・項目が明確です。";
  return "保存先や提出先まで具体化すると使いやすくなります。";
}

function buildStrengths(
  snapshot: PlanSnapshot,
  signals: ContextSignals,
  criteria: EvaluationCriterion[],
): string[] {
  const strengths: string[] = [];
  const byId = (id: EvaluationCriterionId): EvaluationCriterion =>
    criteria.find((criterion) => criterion.id === id) as EvaluationCriterion;

  if (byId("granularity").score >= 16) strengths.push("各ステップの役割と順序が整理されています。");
  if (signals.target && signals.purpose && signals.inputEvidence) {
    strengths.push("対象・目的・入力情報が具体的です。");
  }
  if (byId("safety").score >= 16) {
    strengths.push("隔離・最小権限・機密情報の境界が配慮されています。");
  }
  if (byId("verifiability").score >= 15) {
    strengths.push("成功条件と証跡があり、結果を確認できます。");
  }
  if (byId("artifact").score >= 14) {
    strengths.push("成果物の形式と利用方法が具体的です。");
  }
  return strengths.slice(0, 4);
}

function buildImprovements(
  snapshot: PlanSnapshot,
  signals: ContextSignals,
  criteria: EvaluationCriterion[],
): string[] {
  const improvements: string[] = [];
  const byId = (id: EvaluationCriterionId): EvaluationCriterion =>
    criteria.find((criterion) => criterion.id === id) as EvaluationCriterion;
  const risks = detectSafetyRisks(snapshot.text);

  if (snapshot.steps.length === 0 || snapshot.nonEmptySteps.length === 0) {
    improvements.push("対象・目的を示した手順を2〜8個追加してください。");
  } else if (snapshot.steps.length === 1) {
    improvements.push("取得・解析・判定を別ステップに分けてください。");
  } else if (snapshot.steps.length > 12) {
    improvements.push("細かな操作をまとめ、主要な判断単位に整理してください。");
  }

  if (!signals.target) improvements.push("分析対象（ログ、コード、サービス等）を明記してください。");
  if (!signals.purpose) improvements.push("何を判断・特定したいか目的を明記してください。");
  if (!signals.inputEvidence) improvements.push("入力データと根拠となる証跡を指定してください。");
  if (!signals.scopeConstraints) improvements.push("対象範囲・禁止事項・変更可否を指定してください。");

  if (byId("safety").score < 13 || Object.values(risks).some(Boolean)) {
    improvements.push("隔離・最小権限・機密情報のマスキングを明記してください。");
  }
  if (byId("verifiability").score < 13) {
    improvements.push("成功条件・期待値・確認用の証跡を追加してください。");
  }
  if (byId("artifact").score < 12) {
    improvements.push("成果物の形式・必須項目・保存先を指定してください。");
  }

  return uniqueStrings(improvements).slice(0, 6);
}

function createCriterion(
  spec: CriterionSpec,
  score: number,
  message: string,
  stepDetails?: EvaluationStepDetail[],
): EvaluationCriterion {
  return {
    id: spec.id,
    label: spec.label,
    score: roundedScore(score, spec.max),
    max: spec.max,
    message,
    ...(stepDetails && stepDetails.length > 0 ? { stepDetails } : {}),
  };
}

/**
 * Score an analysis plan with lightweight, deterministic heuristics.
 *
 * This is intentionally a pure function: it performs no I/O, has no runtime
 * dependencies, and can therefore be imported directly from a React client
 * component.  Scores are guidance for the trainer, not a security verdict.
 */
export function evaluatePlan(taskTitle: string, steps: AnalysisStep[]): EvaluationResult {
  const snapshot = createSnapshot(taskTitle, steps);
  const contextSignals = detectContextSignals(snapshot);
  const granularityStepDetails = createStepDetails(
    snapshot,
    scoreStepGranularity,
    granularityStepMessage,
  );
  const contextStepDetails = createStepDetails(snapshot, scoreStepContext, contextStepMessage);
  const granularityScore = scoreGranularity(snapshot, granularityStepDetails);
  const contextScore = scoreContext(snapshot, contextStepDetails);
  const safetyScore = scoreSafety(snapshot);
  const verifiabilityScore = scoreVerifiability(snapshot);
  const artifactScore = scoreArtifact(snapshot);

  const criteria: EvaluationCriterion[] = [
    createCriterion(
      CRITERIA[0],
      granularityScore,
      granularityMessage(snapshot, granularityScore, granularityStepDetails),
      granularityStepDetails,
    ),
    createCriterion(
      CRITERIA[1],
      contextScore,
      contextMessage(snapshot, contextScore, contextStepDetails),
      contextStepDetails,
    ),
    createCriterion(CRITERIA[2], safetyScore, safetyMessage(snapshot, safetyScore)),
    createCriterion(
      CRITERIA[3],
      verifiabilityScore,
      verifiabilityMessage(snapshot, verifiabilityScore),
    ),
    createCriterion(CRITERIA[4], artifactScore, artifactMessage(snapshot, artifactScore)),
  ];

  return {
    criteria,
    strengths: buildStrengths(snapshot, contextSignals, criteria),
    improvements: buildImprovements(snapshot, contextSignals, criteria),
    total: criteria.reduce((sum, criterion) => sum + criterion.score, 0),
  };
}

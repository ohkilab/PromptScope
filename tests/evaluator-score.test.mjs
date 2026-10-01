import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const {
  analyzeStepText,
  applyProhibitedOperationOverrides,
  resolveRubric,
  planEvaluationSchema,
  prohibitedOperationSchema,
  sentenceOptions,
  stepEvaluationSchema,
  scoreEvaluation,
  validatePlanEvaluation,
  validateProhibitedOperations,
  validateStepEvaluation,
} = await tsImport("../app/lib/evaluator.ts", import.meta.url);
const { rubricFor, RUBRIC_VERSION, statusPoints } = await tsImport("../app/lib/rubric.ts", import.meta.url);

const request = {
  scenario: {
    rubricScenarioId: "vulnerability",
    title: "検証用サービスのリスク調査",
    description: "ローカル検証サービスを安全に調べる",
    goal: "リスクと対応優先度を判断できる報告書を作る",
    environment: "許可済みのローカル検証環境",
  },
  steps: [
    {
      id: "scope",
      title: "対象と制約を整理する",
      instruction: "提供資料から対象と許可範囲を確認し、対象一覧を作る。",
      context: "入力は提供されたサービス設定と監査ログです。",
    },
    {
      id: "report",
      title: "根拠付き報告書を作る",
      instruction: "観測結果と根拠を照合し、優先度・緩和策・未確認事項を報告書にまとめる。",
      context: "前段の対象一覧と監査ログを使い、第三者が再確認できる形で記録します。",
    },
  ],
};

function firstSentence(step) {
  return step.instruction.split("。")[0] + "。";
}

/** コンテキスト充足の項目はコンテキスト欄だけを根拠にできるため、その欄の最初の文を使う。 */
function evidenceFor(entry, step) {
  return entry.item.criterion === "context" ? step.context.split("。")[0] + "。" : firstSentence(step);
}

/** statuses: { key: status } for the plan, { "stepId:key": status } for a task. */
function rawPlan(targetRequest, rubric, overrides = {}) {
  return {
    results: rubric.planEntries.map((entry) => {
      const status = overrides.statuses?.[entry.key] ?? "met";
      return {
        key: entry.key,
        status,
        evidence: status === "missing" ? "" : evidenceFor(entry, targetRequest.steps[0]),
        reason: status === "met" ? "" : `${entry.label}が不足しています。`,
      };
    }),
    taskRoles: targetRequest.steps.map((step, index) => ({
      stepId: step.id,
      phase: overrides.roles?.[step.id] ?? rubric.phases[Math.min(index, rubric.phases.length - 1)].id,
      redundant: overrides.redundant?.includes(step.id) ?? false,
    })),
    unsafe: overrides.unsafe ?? [],
    strengths: ["対象と根拠を明示しています。"],
  };
}

function rawStep(step, rubric, overrides = {}) {
  return {
    results: rubric.stepEntries.map((entry) => {
      const status = overrides.statuses?.[`${step.id}:${entry.key}`] ?? "met";
      return {
        key: entry.key,
        status,
        evidence: status === "missing" ? "" : evidenceFor(entry, step),
        reason: status === "met" ? "" : `${entry.label}が不足しています。`,
      };
    }),
  };
}

function evaluate(targetRequest = request, overrides = {}) {
  const rubric = resolveRubric(targetRequest);
  const issues = analyzeStepText(targetRequest);
  const plan = validatePlanEvaluation(rawPlan(targetRequest, rubric, overrides), targetRequest, rubric, issues);
  const steps = targetRequest.steps.map((step, index) =>
    validateStepEvaluation(rawStep(step, rubric, overrides), targetRequest, rubric, step.id, issues[index]));
  return scoreEvaluation(targetRequest, rubric, steps, plan, "ollama", "test-model");
}

function criterion(result, id) {
  return result.criteria.find((item) => item.id === id);
}

test("5種別と例題のルーブリックは各軸20点で、種別ごとに項目と工程が異なる", () => {
  assert.equal(RUBRIC_VERSION, "2026-09-30.5");
  for (const typeId of ["malware", "vulnerability", "logs", "incident-response", "other", "tutorial"]) {
    const definition = rubricFor(typeId);
    for (const axis of ["granularity", "context", "safety", "verifiability", "artifact"]) {
      const total = definition.items.filter((item) => item.criterion === axis).reduce((sum, item) => sum + item.max, 0);
      assert.equal(total, 20, `${typeId} ${axis}`);
      assert.ok(definition.items.some((item) => item.criterion === axis && item.kind === "specific"), `${typeId} ${axis} specific`);
    }
    assert.ok(definition.phases.length >= 3, typeId);
    assert.ok(definition.items.some((item) => item.id === "accuracy" && item.scope === "step"), typeId);
  }
  const safetyIds = (typeId) => rubricFor(typeId).items.filter((item) => item.criterion === "safety").map(({ id }) => id);
  assert.notDeepEqual(safetyIds("malware"), safetyIds("logs"));
  assert.match(rubricFor("malware").phases.map(({ label }) => label).join(), /静的観測/);
  assert.match(rubricFor("incident-response").phases.map(({ label }) => label).join(), /証拠保全/);
});

test("全項目充足なら100点で、判定ごとの点数は整数（おおむね=満点−1、言及のみ=半分切り捨て）", () => {
  const perfect = evaluate();
  assert.deepEqual(perfect.criteria.map(({ score }) => score), [20, 20, 20, 20, 20]);
  assert.equal(perfect.total, 100);
  assert.equal(perfect.passed, true);
  assert.equal(perfect.rubricType, "vulnerability");
  assert.equal(perfect.rubricVersion, RUBRIC_VERSION);
  const table = [2, 3, 4, 5, 6].map((max) => ["met", "mostly", "partial", "missing"].map((status) => statusPoints(max, status)));
  assert.deepEqual(table, [[2, 1, 1, 0], [3, 2, 1, 0], [4, 3, 2, 0], [5, 4, 2, 0], [6, 5, 3, 0]]);

  const mostly = evaluate(request, { statuses: { secrets: "mostly" } });
  assert.equal(criterion(mostly, "safety").score, 19);
  const partial = evaluate(request, { statuses: { secrets: "partial" } });
  assert.equal(criterion(partial, "safety").score, 18);
  const partialStop = evaluate(request, { statuses: { "out-of-scope-stop": "partial" } });
  assert.equal(criterion(partialStop, "safety").score, 18);
  assert.equal(partial.passed, true, "必須でない項目の不足は点数だけに反映する");
});

test("中核項目の未充足は点数を上限で切らず、合格だけを止める", () => {
  const result = evaluate(request, { statuses: { "authorized-scope": "missing" } });
  assert.equal(criterion(result, "safety").score, 15);
  assert.equal(result.total, 95);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /中核項目「許可範囲への限定」が未充足/);

  const phase = evaluate(request, { statuses: { "coverage:remediation": "missing" } });
  assert.equal(criterion(phase, "granularity").score, 19);
  assert.match(phase.gateFailures.join(" "), /必要な工程の網羅：緩和策と修正後の再確認/);
});

test("各タスクの分割粒度とコンテキスト充足は20点換算で12点以上が必要", () => {
  const result = evaluate(request, { statuses: {
    "report:purpose": "partial",
    "report:size": "partial",
    "report:handoff": "partial",
  } });
  const granularity = criterion(result, "granularity");
  const weakStep = granularity.stepDetails.find((detail) => detail.stepId === "report");
  assert.equal(weakStep.max, 20);
  assert.equal(weakStep.score, 9, "6/13を20点換算して切り捨て");
  assert.equal(granularity.score, 16, "4+3+floor(7/2)+floor(6/2)+floor(6/2)");
  assert.ok(result.criteria.every(({ score }) => Number.isInteger(score)));
  const purpose = granularity.findings.find(({ code }) => code === "purpose");
  assert.equal(purpose.points, 2);
  assert.deepEqual(purpose.stepReferences, ["タスク2「根拠付き報告書を作る」：言及のみ"]);
  assert.ok(result.total >= 80);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /タスク2の分割粒度が12点未満/);
});

test("どの工程にも当たらない・重複するタスクは1つにつき網羅を1点下げる", () => {
  const padded = {
    ...request,
    steps: [...request.steps, {
      id: "extra",
      title: "ハッシュを記録する",
      instruction: "監査ログのハッシュを記録する。",
      context: "入力は監査ログです。",
    }],
  };
  const result = evaluate(padded, { roles: { extra: "none" } });
  const granularity = criterion(result, "granularity");
  assert.equal(granularity.subcriteria.find(({ id }) => id === "coverage").score, 3);
  assert.ok(granularity.findings.some((finding) => finding.code === "padding" && /タスク3/.test(finding.stepReferences.join())));

  const redundant = evaluate(padded, { redundant: ["extra"] });
  assert.equal(criterion(redundant, "granularity").subcriteria.find(({ id }) => id === "coverage").score, 3);
  const twoPadding = evaluate(padded, { roles: { extra: "none" }, redundant: ["report"] });
  assert.equal(criterion(twoPadding, "granularity").subcriteria.find(({ id }) => id === "coverage").score, 2);
});

test("禁止操作の明示的な指示だけ総合を29点に制限し、否定文は除外する", () => {
  const unsafe = evaluate(request, { unsafe: [{ stepId: "scope", evidence: firstSentence(request.steps[0]), reason: "範囲外の操作" }] });
  assert.equal(unsafe.total, 29);
  assert.equal(unsafe.deductions.length, 1);
  assert.equal(unsafe.deductions[0].cap, 29);
  assert.match(unsafe.improvements[0], /禁止操作/);

  const negatedRequest = {
    ...request,
    steps: [{ ...request.steps[0], instruction: "本番環境へ接続しない。" }, request.steps[1]],
  };
  const negated = evaluate(negatedRequest, { unsafe: [{ stepId: "scope", evidence: "本番環境へ接続しない。", reason: "接続" }] });
  assert.equal(negated.deductions.length, 0);
  assert.equal(negated.total, 100);
});

test("禁止操作が検出されたら、安全性・権限境界の軸自体も上限5点に制限する", () => {
  const unsafe = evaluate(request, { unsafe: [{ stepId: "scope", evidence: firstSentence(request.steps[0]), reason: "範囲外の操作" }] });
  const safety = criterion(unsafe, "safety");
  assert.equal(safety.score, 5, "各項目の判定にかかわらず軸自体が上限5点になる");
  assert.match(safety.message, /上限5点に制限/);
  assert.match(unsafe.gateFailures.join(" "), /安全性・権限境界は12点以上が必要/, "軸の上限により12点未満ゲートも連動する");
  // 個別項目のsubcriteriaは上限の影響を受けず、元の判定（met等）のまま表示する。
  assert.ok(safety.subcriteria.every((item) => item.status === "met"));

  const negatedRequest = {
    ...request,
    steps: [{ ...request.steps[0], instruction: "本番環境へ接続しない。" }, request.steps[1]],
  };
  const negated = evaluate(negatedRequest, { unsafe: [{ stepId: "scope", evidence: "本番環境へ接続しない。", reason: "接続" }] });
  assert.equal(criterion(negated, "safety").score, 20, "unsafeが検出されなければ軸の上限はかからない");
});

test("無意味な入力はLLMの判定にかかわらず未充足にし、混ざった無意味な語と識別子の誤りは記述の正確さで扱う", () => {
  const noiseRequest = {
    ...request,
    steps: [{ ...request.steps[0], instruction: "aaaaaa asdf", context: "TODO" }, request.steps[1]],
  };
  const rubric = resolveRubric(noiseRequest);
  const issues = analyzeStepText(noiseRequest);
  assert.equal(issues[0].empty, true);
  const raw = rawStep(noiseRequest.steps[0], rubric);
  // LLMが無意味な文字列を根拠に充足と返しても、コードの判定で未充足にする。
  raw.results = raw.results.map((item) => ({ ...item, evidence: rubric.stepEntries.find(({ key }) => key === item.key).item.criterion === "context" ? "TODO" : "aaaaaa asdf" }));
  const results = validateStepEvaluation(raw, noiseRequest, rubric, "scope", issues[0]);
  assert.ok(results.every((result) => result.status === "missing"));

  const fragment = analyzeStepText({ ...request, steps: [{ ...request.steps[0], context: "入力は監査ログですああああ。" }] });
  assert.equal(fragment[0].empty, false);
  assert.deepEqual(fragment[0].noiseFragments, ["ああああ"]);
  const fragmentRequest = { ...request, steps: [{ ...request.steps[0], context: "入力は監査ログですああああ。" }, request.steps[1]] };
  const fragmentResult = evaluate(fragmentRequest);
  const accuracy = criterion(fragmentResult, "context").stepDetails[0].subcriteria.find(({ id }) => id === "accuracy");
  assert.equal(accuracy.status, "partial");

  const identifiers = analyzeStepText({
    ...request,
    scenario: { ...request.scenario, environment: "隔離VMに sample.exe を配置済み" },
    steps: [
      { ...request.steps[0], instruction: "前段の一覧から sampel.exe のハッシュを確認する。" },
      { ...request.steps[1], instruction: "タスク5の結果を報告する。" },
    ],
  });
  assert.match(identifiers[0].identifierIssues.join(), /存在しない前段/);
  assert.match(identifiers[0].identifierIssues.join(), /sampel\.exe.*sample\.exe/);
  assert.match(identifiers[1].identifierIssues.join(), /タスク5/);
});

test("自作問題は分野のルーブリックと、利用者の評価観点・工程リストで判定する", () => {
  const custom = (domain, profile = {}) => resolveRubric({
    ...request,
    scenario: {
      ...request.scenario,
      rubricScenarioId: "custom",
      evaluationProfile: {
        domain,
        focus: { granularity: "受付票ごとに分ける。", context: "", safety: "", verifiability: "", artifact: "" },
        incidentIds: [],
        references: [],
        ...profile,
      },
    },
  });
  const logs = custom("logs");
  assert.equal(logs.typeId, "logs");
  assert.match(logs.planEntries.find(({ key }) => key === "specific-granularity").description, /受付票ごとに分ける/);
  assert.match(logs.planEntries.find(({ key }) => key === "specific-context").description, /タイムゾーン/, "空欄は分野の既定観点");
  assert.ok(logs.planEntries.some(({ key }) => key === "coverage:timeline"));

  const other = custom("other", { phases: ["受付", "分類", "回答"] });
  assert.deepEqual(other.phases.map(({ label }) => label), ["受付", "分類", "回答"]);
  assert.equal(custom("other").phases.length, 4);

  const standard = resolveRubric({ ...request, scenario: { ...request.scenario, rubricScenarioId: "logs" } });
  assert.match(standard.specificCriteria.granularity, /匿名化識別子ごと/);
});

test("判定の欠落と入力にない根拠を拒否する", () => {
  const rubric = resolveRubric(request);
  const issues = analyzeStepText(request);
  const missing = rawStep(request.steps[0], rubric);
  missing.results.pop();
  assert.throws(() => validateStepEvaluation(missing, request, rubric, "scope", issues[0]), /missing task scope result/);

  const fabricated = rawPlan(request, rubric);
  fabricated.results[0].evidence = "存在しない根拠。";
  assert.throws(() => validatePlanEvaluation(fabricated, request, rubric, issues), /evidence not found/);

  const invalidRole = rawPlan(request, rubric);
  invalidRole.taskRoles[0].stepId = "unknown";
  assert.throws(() => validatePlanEvaluation(invalidRole, request, rubric, issues), /invalid stepId/);
});

test("根拠の候補はファイル名の途中で文を区切らず、理由が空なら項目名を重複させない", () => {
  assert.deepEqual(sentenceOptions(["sample.exe のハッシュを記録する。次に報告する。"]),
    ["sample.exe のハッシュを記録する。", "次に報告する。"]);

  const rubric = resolveRubric(request);
  const issues = analyzeStepText(request);
  const raw = rawPlan(request, rubric, { statuses: { secrets: "partial" } });
  raw.results.find(({ key }) => key === "secrets").reason = "";
  const plan = validatePlanEvaluation(raw, request, rubric, issues);
  const steps = request.steps.map((step, index) => validateStepEvaluation(rawStep(step, rubric), request, rubric, step.id, issues[index]));
  const result = scoreEvaluation(request, rubric, steps, plan, "ollama", "test-model");
  assert.ok(result.improvements.some((message) => message.startsWith("認証情報と秘密値の扱い：見つけた秘密値")));

  const phase = evaluate(request, { statuses: { "coverage:remediation": "missing", "coverage:impact": "partial" } });
  const coverage = criterion(phase, "granularity").findings.find(({ code }) => code === "coverage");
  assert.equal(coverage.points, 2, "floor((4+4+2+0)/4)=2");
  assert.match(coverage.guidance, /緩和策と修正後の再確認（未充足）/);
});

test("コンテキスト充足は、コンテキスト欄の文だけを根拠にできる", () => {
  // 指示欄は同じで、コンテキスト欄だけを空にした計画（投稿ケースの context-fields-empty に相当）。
  const emptyContext = { ...request, steps: request.steps.map((step) => ({ ...step, context: "" })) };
  const rubric = resolveRubric(emptyContext);
  const schema = stepEvaluationSchema(rubric, emptyContext.steps[0], emptyContext.scenario);
  const grounded = schema.properties.results.items.anyOf.filter((variant) => variant.properties.status.enum[0] !== "missing");
  const contextKeys = rubric.stepEntries.filter(({ item }) => item.criterion === "context" && item.id !== "inputs").map(({ key }) => key);
  assert.ok(grounded.every((variant) => contextKeys.every((key) => !variant.properties.key.enum.includes(key))),
    "コンテキスト欄が空なら、対象・入力の特定以外のコンテキスト充足の項目は未充足しか選べない");
  // 対象・入力の特定は、演習の問題文の文だけを根拠にできる（指示欄の文は選べない）。
  const inputs = grounded.find((variant) => variant.properties.key.enum.includes("inputs"));
  assert.deepEqual(inputs.properties.key.enum, ["inputs"]);
  assert.ok(inputs.properties.evidence.enum.includes("検証用サービスのリスク調査"));
  assert.ok(!inputs.properties.evidence.enum.includes(firstSentence(emptyContext.steps[0])));

  // 指示欄の文をコンテキスト充足の根拠にした応答は受け付けない。
  const issues = analyzeStepText(emptyContext);
  const raw = rawStep(emptyContext.steps[0], rubric);
  raw.results = raw.results.map((item) => ({ ...item, evidence: firstSentence(emptyContext.steps[0]) }));
  assert.throws(() => validateStepEvaluation(raw, emptyContext, rubric, "scope", issues[0]), /evidence not found in task scope for inputs/);

  const plan = rawPlan(request, rubric);
  const premise = plan.results.find(({ key }) => key.startsWith("premises:"));
  premise.evidence = firstSentence(request.steps[0]);
  assert.throws(() => validatePlanEvaluation(plan, request, resolveRubric(request), analyzeStepText(request)), /evidence not found in plan for premises:/);
  const planSchema = planEvaluationSchema(rubric, emptyContext);
  const planGrounded = planSchema.properties.results.items.anyOf.filter((variant) => variant.properties.status.enum[0] !== "missing");
  assert.ok(planGrounded.every((variant) => !variant.properties.key.enum.some((key) => key.startsWith("premises:") || key === "specific-context")));
});

test("停止条件の配点は、全分野で4点にそろえる", () => {
  const stopItems = { vulnerability: "out-of-scope-stop", logs: "stop", "incident-response": "rollback", other: "stop" };
  for (const [typeId, itemId] of Object.entries(stopItems)) {
    assert.equal(rubricFor(typeId).items.find(({ id }) => id === itemId).max, 4, typeId);
  }
});

test("malwareのSafetyは、タスクごとの安全対策をタスク別項目として8点で評価する", () => {
  const items = rubricFor("malware").items.filter((item) => item.criterion === "safety");
  const taskSafety = items.find(({ id }) => id === "task-safety");
  assert.equal(taskSafety.max, 8);
  assert.equal(taskSafety.scope, "step");
  assert.equal(taskSafety.core, true);
  assert.equal(items.reduce((sum, item) => sum + item.max, 0), 20);
});

test("コンテキスト充足は、種別の必須前提・問題固有の観点と、タスクごとの4項目で20点になる", () => {
  for (const typeId of ["malware", "vulnerability", "logs", "incident-response", "other"]) {
    const context = rubricFor(typeId).items.filter((item) => item.criterion === "context");
    assert.deepEqual(context.map(({ id, max }) => [id, max]), [
      ["premises", 4], ["specific-context", 3], ["inputs", 5], ["needs", 3], ["missing-input", 3], ["accuracy", 2],
    ], typeId);
  }
});

// ---------------------------------------------------------------------------
// 禁止操作の分離検出とtask-safetyのapplicable欄（境界ケース）
// ---------------------------------------------------------------------------

const malwareRequest = {
  scenario: {
    rubricScenarioId: "malware",
    title: "sample.exe の確認",
    description: "架空の検体を隔離環境で確認する",
    goal: "観測事実と未確認事項を分けた報告を作る",
    environment: "隔離済みの使い捨てVM、ネットワーク遮断済み",
  },
  steps: [
    {
      id: "collect",
      title: "ハッシュを記録する",
      instruction: "sample.exe のハッシュを読み取り専用で記録する。",
      context: "検体は隔離ラボにあります。",
    },
    {
      id: "report",
      title: "結果を報告する",
      instruction: "観測結果を事実・解釈・未確認事項に分けて報告書にまとめる。",
      context: "前段の記録を使います。",
    },
  ],
};

function rawFlags(targetRequest, overrides = {}) {
  return {
    flags: targetRequest.steps.map((step) => {
      const flag = overrides[step.id];
      return flag
        ? { stepId: step.id, prohibited: true, sentence: flag.sentence, reason: flag.reason ?? "禁止操作です。" }
        : { stepId: step.id, prohibited: false, sentence: "", reason: "" };
    }),
  };
}

/** rawStepの結果に、allowNotApplicableを持つ項目へapplicable:trueを補う（既定は適用されるものとして扱う）。 */
function withApplicable(raw, rubric) {
  const naKeys = new Set(rubric.stepEntries.filter((entry) => entry.item.allowNotApplicable === true).map((entry) => entry.key));
  return { ...raw, results: raw.results.map((item) => naKeys.has(item.key) ? { ...item, applicable: true } : item) };
}

test("validateProhibitedOperationsは、該当する文が入力に実在する場合だけflagを返す", () => {
  const flags = validateProhibitedOperations(
    rawFlags(malwareRequest, { collect: { sentence: "sample.exe のハッシュを読み取り専用で記録する。" } }),
    malwareRequest,
  );
  assert.deepEqual(flags.map((flag) => flag.stepId), ["collect"]);
  assert.equal(flags[0].sentence, "sample.exe のハッシュを読み取り専用で記録する。");
});

test("validateProhibitedOperationsは、境界ケースを正しく扱う", () => {
  // 全タスクprohibited=falseなら空配列。
  assert.deepEqual(validateProhibitedOperations(rawFlags(malwareRequest), malwareRequest), []);

  // prohibited=trueでもsentenceが空文字なら無視する（LLMの不完全な出力を安全側に倒す）。
  const emptySentence = rawFlags(malwareRequest);
  emptySentence.flags[0] = { stepId: "collect", prohibited: true, sentence: "", reason: "" };
  assert.deepEqual(validateProhibitedOperations(emptySentence, malwareRequest), []);

  // 入力に実在しない文はハルシネーションとして拒否する（検証失敗→呼び出し元で1回再試行）。
  assert.throws(() => validateProhibitedOperations(
    rawFlags(malwareRequest, { collect: { sentence: "管理者権限で全ファイルを削除してください。" } }),
    malwareRequest,
  ), /not found/);

  // タスク分のflagsが欠けていれば拒否する。
  const missingStep = rawFlags(malwareRequest);
  missingStep.flags.pop();
  assert.throws(() => validateProhibitedOperations(missingStep, malwareRequest), /missing flags/);

  // prohibitedが真偽値でなければ拒否する。
  const badType = rawFlags(malwareRequest);
  badType.flags[0] = { ...badType.flags[0], prohibited: "yes" };
  assert.throws(() => validateProhibitedOperations(badType, malwareRequest), /invalid prohibited/);
});

test("applyProhibitedOperationOverridesは、flagsが空なら何も変えない", () => {
  const rubric = resolveRubric(malwareRequest);
  const issues = analyzeStepText(malwareRequest);
  const plan = validatePlanEvaluation(rawPlan(malwareRequest, rubric), malwareRequest, rubric, issues);
  const steps = malwareRequest.steps.map((step, index) =>
    validateStepEvaluation(withApplicable(rawStep(step, rubric), rubric), malwareRequest, rubric, step.id, issues[index]));
  const result = applyProhibitedOperationOverrides(plan, steps, malwareRequest, []);
  assert.equal(result.plan, plan);
  assert.equal(result.stepResults, steps);
});

test("applyProhibitedOperationOverridesは、検出した文をunsafeへ反映し、同じ文を根拠にした判定をmissingへ強制する", () => {
  const rubric = resolveRubric(malwareRequest);
  const issues = analyzeStepText(malwareRequest);
  const dangerousSentence = "sample.exe のハッシュを読み取り専用で記録する。";
  // LLMがこの文を「実行の禁止範囲」等の根拠としてmetに使ってしまったケースを再現する。
  const plan = validatePlanEvaluation(
    rawPlan(malwareRequest, rubric, { statuses: {} }),
    malwareRequest, rubric, issues,
  );
  const steps = malwareRequest.steps.map((step, index) =>
    validateStepEvaluation(withApplicable(rawStep(step, rubric), rubric), malwareRequest, rubric, step.id, issues[index]));

  const flags = [{ stepId: "collect", sentence: dangerousSentence, reason: "禁止操作を実行させる指示です。" }];
  const overridden = applyProhibitedOperationOverrides(plan, steps, malwareRequest, flags);

  // unsafeへ追加される（LLM自身のunsafeが空でも、見逃しをコード側で補う）。
  assert.equal(overridden.plan.unsafe.length, 1);
  assert.equal(overridden.plan.unsafe[0].stepId, "collect");

  // plan.resultsのうち、この文を根拠にしていた項目はmissingへ強制される。
  const planHit = overridden.plan.results.find((result) => result.evidence === dangerousSentence);
  assert.equal(planHit, undefined, "evidenceがmissing化で空文字になっているはず");
  const downgradedPlanItems = overridden.plan.results.filter((result, index) =>
    plan.results[index].evidence === dangerousSentence);
  assert.ok(downgradedPlanItems.length > 0, "根拠にしていた項目が存在するはず");
  assert.ok(downgradedPlanItems.every((result) => result.status === "missing"));

  // 該当タスク（collect）のstep結果も同様にmissing化される。
  const collectIndex = malwareRequest.steps.findIndex((step) => step.id === "collect");
  const downgradedStepItems = overridden.stepResults[collectIndex].filter((result, index) =>
    steps[collectIndex][index].evidence === dangerousSentence);
  assert.ok(downgradedStepItems.length > 0);
  assert.ok(downgradedStepItems.every((result) => result.status === "missing"));

  // 無関係なタスク（report）は変更されない。
  const reportIndex = malwareRequest.steps.findIndex((step) => step.id === "report");
  assert.deepEqual(overridden.stepResults[reportIndex], steps[reportIndex]);
});

test("applyProhibitedOperationOverridesは、LLMが既に同じ文をunsafeに報告していれば重複追加しない", () => {
  const rubric = resolveRubric(malwareRequest);
  const issues = analyzeStepText(malwareRequest);
  const dangerousSentence = "sample.exe のハッシュを読み取り専用で記録する。";
  const plan = validatePlanEvaluation(
    rawPlan(malwareRequest, rubric, { unsafe: [{ stepId: "collect", evidence: dangerousSentence, reason: "既存の検出" }] }),
    malwareRequest, rubric, issues,
  );
  const steps = malwareRequest.steps.map((step, index) =>
    validateStepEvaluation(withApplicable(rawStep(step, rubric), rubric), malwareRequest, rubric, step.id, issues[index]));
  const flags = [{ stepId: "collect", sentence: dangerousSentence, reason: "禁止操作を実行させる指示です。" }];
  const overridden = applyProhibitedOperationOverrides(plan, steps, malwareRequest, flags);
  assert.equal(overridden.plan.unsafe.length, 1, "同一の文を重複して追加しない");
});

test("task-safetyはapplicable=falseならstatusにかかわらずmetとして扱う", () => {
  const rubric = resolveRubric(malwareRequest);
  const issues = analyzeStepText(malwareRequest);
  const step = malwareRequest.steps[1];
  const raw = rawStep(step, rubric);
  raw.results = raw.results.map((item) => item.key === "task-safety"
    ? { ...item, applicable: false, status: "missing", evidence: "", reason: "" }
    : { ...item, applicable: true });
  const results = validateStepEvaluation(raw, malwareRequest, rubric, step.id, issues[1]);
  const taskSafety = results.find((result) => result.entry.item.id === "task-safety");
  assert.equal(taskSafety.status, "met");
  assert.equal(taskSafety.evidence, "");
  assert.match(taskSafety.reason, /不要/);
});

test("task-safetyはapplicableが真偽値でなければ拒否し、他項目はapplicable欄を要求しない", () => {
  const rubric = resolveRubric(malwareRequest);
  const issues = analyzeStepText(malwareRequest);
  const step = malwareRequest.steps[0];
  const raw = rawStep(step, rubric);
  raw.results = raw.results.map((item) => item.key === "task-safety" ? { ...item, applicable: "yes" } : item);
  assert.throws(() => validateStepEvaluation(raw, malwareRequest, rubric, step.id, issues[0]), /missing applicable/);

  // 他の項目にapplicable=falseが紛れ込んでも（本来schemaで弾かれるが）、無視してstatusをそのまま使う。
  const otherRaw = withApplicable(rawStep(step, rubric), rubric);
  otherRaw.results = otherRaw.results.map((item) => item.key === "purpose" ? { ...item, applicable: false } : item);
  const results = validateStepEvaluation(otherRaw, malwareRequest, rubric, step.id, issues[0]);
  const purpose = results.find((result) => result.entry.item.id === "purpose");
  assert.equal(purpose.status, "met", "allowNotApplicableを持たない項目にはapplicableの効果がない");
});

test("resultsSchemaは、task-safetyを他のstep項目と別のevidenceグループにしてapplicable欄を付ける", () => {
  const rubric = resolveRubric(malwareRequest);
  const schema = stepEvaluationSchema(rubric, malwareRequest.steps[0], malwareRequest.scenario);
  const variants = schema.properties.results.items.anyOf;
  const taskSafetyVariant = variants.find((variant) => variant.properties.key.enum.includes("task-safety"));
  assert.ok("applicable" in taskSafetyVariant.properties);
  assert.ok(taskSafetyVariant.required.includes("applicable"));
  const purposeVariant = variants.find((variant) => variant.properties.key.enum.includes("purpose"));
  assert.ok(!("applicable" in purposeVariant.properties), "他の項目にはapplicable欄を追加しない");
  assert.ok(!purposeVariant.properties.key.enum.includes("task-safety"), "task-safetyは他項目とグループを分ける");
});

test("prohibitedOperationSchemaは、タスク数ぶんのflagsを要求する", () => {
  const schema = prohibitedOperationSchema(malwareRequest);
  assert.equal(schema.properties.flags.minItems, 2);
  assert.equal(schema.properties.flags.maxItems, 2);
  assert.deepEqual(schema.properties.flags.items.properties.stepId.enum, ["collect", "report"]);
});

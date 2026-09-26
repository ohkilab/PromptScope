import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEvaluation, emptyEvaluation, evidenceSources } from "../app/lib/evaluator.ts";
import { rubricFor, PENALTY_SPECS } from "../app/lib/rubric.ts";

const request = {
  scenarioId: "logs",
  steps: [
    { id: "a", title: "確認", instruction: "入力ログの期間と欠損を確認し、原本を変更しない。", context: "架空の匿名化ログ。" },
    { id: "b", title: "比較", instruction: "認証イベントの行IDを時系列表に記録する。", context: "前段で確認したログ。" },
  ],
};
const citation = (step, input = request) => evidenceSources(input.steps).find((source) => source.stepId === step.id && source.field === "instruction").sourceId;
// Deliberately optimistic model output: tests verify server constraints independently of its judgment.
function optimistic(input = request) {
  const evidence = input.steps.filter((step) => step.instruction).map((step) => citation(step, input));
  return {
    relevance: { status: "relevant", reason: "課題への指示があります。", evidence: evidence.slice(0, 1) },
    checks: rubricFor(input.scenarioId).map((spec) => ({ id: spec.id, status: "met", missingElements: [], reason: "具体的な記述。", evidence: structuredClone(evidence) })),
    violations: PENALTY_SPECS.map((spec) => ({ id: spec.id, present: false, reason: "該当なし。", evidence: [] })),
  };
}
const grade = (raw, input = request) => normalizeEvaluation(raw, input, "ollama", "test");
const item = (raw, id) => raw.checks.find((check) => check.id === id);
const violation = (raw, id) => raw.violations.find((check) => check.id === id);

test("明示的な全充足判定は固定配点で100点になる（LLMの自己申告点は使わない）", () => {
  const raw = optimistic(); raw.total = -100; raw.passed = false;
  const result = grade(raw);
  assert.equal(result.total, 100); assert.equal(result.passed, true);
  assert.deepEqual(result.criteria.map((axis) => axis.score), [20, 20, 20, 20, 20]);
});

test("必須要素が1つでも欠ければ、他が満点でも59点以下", () => {
  for (const spec of rubricFor("logs").filter((entry) => entry.required)) {
    const raw = optimistic(); Object.assign(item(raw, spec.id), { status: "missing", evidence: [] });
    const result = grade(raw);
    assert.ok(result.total <= 59, spec.id); assert.equal(result.passed, false);
    assert.ok(result.requiredMissing.includes(spec.label)); assert.equal(result.deduction, 0);
  }
});

test("抽象的な言及は25%加点、必須項目なら79点以下", () => {
  const raw = optimistic(); item(raw, "coverage").status = "partial";
  const result = grade(raw);
  assert.equal(result.earned, 94); assert.equal(result.total, 79); assert.equal(result.passed, false);
});

test("全項目が抽象的な計画は25点、関連語だけの回答も高得点にならない", () => {
  const raw = optimistic(); raw.checks.forEach((check) => check.status = "partial");
  raw.relevance.status = "partial";
  assert.equal(grade(raw).total, 25);
});

test("無関係な回答は、項目の判定が楽観的でも0点", () => {
  const raw = optimistic(); raw.relevance.status = "irrelevant";
  assert.equal(grade(raw).total, 0);
});

test("全空欄はLLMなしで0点。タイトルだけを根拠にしない", () => {
  const input = { scenarioId: "logs", steps: [{ id: "a", title: "完璧な計画", instruction: "", context: "" }] };
  assert.equal(emptyEvaluation(input).total, 0);
  assert.equal(emptyEvaluation(input).provider, "rules");
  assert.equal(grade(optimistic(input), input).total, 0);
});

test("良いタスクに空タスクを混ぜても49点以下", () => {
  const input = structuredClone(request); input.steps.push({ id: "empty", title: "", instruction: "", context: "" });
  const result = grade(optimistic(input), input);
  assert.ok(result.total <= 49); assert.equal(result.passed, false);
});

test("全タスクを要する項目は一部だけの引用で満点にできない", () => {
  const raw = optimistic(); item(raw, "acceptance").evidence = [citation(request.steps[0])];
  const result = grade(raw);
  const check = result.criteria.flatMap((axis) => axis.checks).find((check) => check.id === "acceptance");
  assert.equal(check.status, "partial"); assert.equal(check.score, 2); assert.equal(result.passed, false);
});

test("存在しない参照番号・別タスクの架空IDは加点しない", () => {
  for (const evidence of [["s999-i1"], ["s1-c99"], ["title-a"]]) {
    const raw = optimistic(); item(raw, "acceptance").evidence = evidence;
    assert.ok(grade(raw).total <= 59);
  }
});

test("引用はサーバーが本文から取り出し、改行や句読点を含め原文に存在する", () => {
  const input = structuredClone(request); input.steps[0].instruction = "  入力ログを確認。\n欠損があれば停止！ " + "長".repeat(450);
  const sources = evidenceSources(input.steps);
  for (const source of sources) {
    assert.ok(input.steps.find((step) => step.id === source.stepId)[source.field].includes(source.quote));
    assert.ok(source.quote.length <= 400);
  }
  assert.equal(new Set(sources.map((source) => source.sourceId)).size, sources.length);
  const raw = optimistic(input);
  const result = grade(raw, input);
  assert.equal(result.criteria[0].checks[0].evidence[0].quote, "入力ログを確認。");
});

test("必須IDの欠落・重複・未知IDは採点エラーにする", () => {
  for (const mutate of [
    (raw) => raw.checks.pop(),
    (raw) => raw.checks[1] = raw.checks[0],
    (raw) => raw.checks[0].id = "unknown",
    (raw) => raw.violations.pop(),
    (raw) => raw.checks[0].status = "excellent",
  ]) {
    const raw = optimistic(); mutate(raw); assert.throws(() => grade(raw));
  }
});

test("禁止操作は固定25点減点し、他が満点でも最大29点", () => {
  const raw = optimistic(); Object.assign(violation(raw, "unsafe"), { present: true, evidence: [citation(request.steps[0])] });
  const result = grade(raw);
  assert.equal(result.deduction, 25); assert.equal(result.total, 29); assert.equal(result.passed, false);
});

test("禁止を指示した文章をキーワードだけで自動減点しない", () => {
  const input = structuredClone(request); input.steps[0].instruction += "DoS、破壊的変更、外部接続はせず、実環境で実行しない。";
  assert.equal(grade(optimistic(input), input).deduction, 0);
});

test("同じ禁止操作を矛盾として二重減点しない", () => {
  const raw = optimistic();
  Object.assign(violation(raw, "unsafe"), { present: true, evidence: [citation(request.steps[0])] });
  Object.assign(violation(raw, "contradiction"), { present: true, evidence: request.steps.map((step) => citation(step)) });
  assert.equal(grade(raw).deduction, 25);
});

test("矛盾には検証可能な2箇所、違反には存在する引用を要求する", () => {
  const raw = optimistic(); Object.assign(violation(raw, "contradiction"), { present: true, evidence: [citation(request.steps[0])] });
  assert.throws(() => grade(raw));
  Object.assign(violation(raw, "contradiction"), { evidence: request.steps.map((step) => citation(step)) });
  assert.equal(grade(raw).total, 79);
  violation(raw, "contradiction").evidence[0] = "nonexistent";
  assert.throws(() => grade(raw));
});

test("同じタスクを複製しても加点は増えず、水増し減点は1回", () => {
  const input = structuredClone(request); input.steps.push({ ...input.steps[0], id: "copy", title: "別のタイトル" });
  const raw = optimistic(input);
  assert.equal(grade(raw, input).earned, 100); assert.equal(grade(raw, input).total, 95);
  Object.assign(violation(raw, "padding"), { present: true, evidence: [citation(input.steps[2], input)] });
  assert.equal(grade(raw, input).deduction, 5);
});

test("必須項目削除で点が上がらず、再採点による加点の累積もない", () => {
  const raw = optimistic(); const before = grade(raw);
  item(raw, "coverage").status = "missing"; item(raw, "coverage").evidence = [];
  assert.ok(grade(raw).total < before.total); assert.deepEqual(grade(raw), grade(raw));
});

test("4演習とも合計100点で、固有の主要工程・禁止事項を持つ", () => {
  for (const id of ["malware", "vulnerability", "logs", "tutorial"]) {
    const rubric = rubricFor(id); assert.equal(rubric.reduce((sum, check) => sum + check.max, 0), 100);
    assert.equal(new Set(rubric.map((check) => check.id)).size, 15);
  }
  assert.match(rubricFor("logs")[0].description, /時系列化/);
  assert.match(rubricFor("tutorial").find((check) => check.id === "boundaries").description, /VMや検体の安全対策は不要/);
});

test("不足要素を挙げた応答が充足を自己申告しても、必須要件は合格扱いにしない", () => {
  const raw = optimistic(); item(raw, "stop").missingElements = ["中断する具体的な事象", "中断する作業"];
  const result = grade(raw);
  assert.ok(result.total <= 79); assert.equal(result.passed, false);
  assert.match(result.criteria.flatMap((axis) => axis.checks).find((check) => check.id === "stop").reason, /中断する具体的な事象/);
});

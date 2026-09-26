import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITERION_SPECS,
  normalizeEvaluation,
} from "../app/lib/evaluator.ts";

test("総合点が80点以上でも具体性の低いタスクがあれば不合格にする", () => {
  const steps = [
    { id: "good", title: "ログを確認する", instruction: "ログを確認する", context: "入力ログ" },
    { id: "empty", title: "", instruction: "", context: "" },
  ];
  const criteria = CRITERION_SPECS.map((criterion) => ({
    id: criterion.id,
    score: 20,
    message: `${criterion.label}の評価`,
  }));
  const result = normalizeEvaluation(
    {
      criteria,
      stepEvaluations: steps.map((step, index) => ({
        stepId: step.id,
        stepNumber: index + 1,
        title: step.title || `分析タスク ${index + 1}`,
        granularity: { score: index === 0 ? 20 : 11, message: "粒度の評価" },
        context: { score: index === 0 ? 20 : 11, message: "文脈の評価" },
      })),
      strengths: ["具体的です。"],
      improvements: ["空欄を埋めてください。"],
    },
    steps,
    "ollama",
    "test-model",
  );

  assert.equal(result.criteria.length, 5);
  assert.equal(result.criteria[0].score, 16);
  assert.equal(result.criteria[1].score, 16);
  assert.equal(result.criteria[0].stepDetails.length, 2);
  assert.equal(result.total, 92);
  assert.equal(result.passed, false);
  assert.deepEqual(result.gateFailures, [
    "タスク2の分割粒度は12点以上が必要です。",
    "タスク2のコンテキスト充足は12点以上が必要です。",
  ]);
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "test-model");
});

test("総合点と全タスクの最低点を満たした場合だけ合格にする", () => {
  const steps = [
    {
      id: "complete",
      title: "証拠を確認する",
      instruction: "対象と完了条件を指定して確認する",
      context: "入力証拠と制約を指定する",
    },
  ];
  const criteria = CRITERION_SPECS.map((criterion) => ({
    id: criterion.id,
    score: 16,
    message: `${criterion.label}の評価`,
  }));
  const result = normalizeEvaluation(
    {
      criteria,
      stepEvaluations: [{
        stepId: "complete",
        stepNumber: 1,
        title: "証拠を確認する",
        granularity: { score: 16, message: "粒度の評価" },
        context: { score: 16, message: "文脈の評価" },
      }],
      strengths: ["具体的です。"],
      improvements: [],
    },
    steps,
    "openrouter",
    "test-model",
  );

  assert.equal(result.total, 80);
  assert.equal(result.passed, true);
  assert.deepEqual(result.gateFailures, []);
});

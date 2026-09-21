import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITERION_SPECS,
  normalizeEvaluation,
} from "../app/lib/evaluator.ts";

test("LLMの構造化結果を5軸・タスク別評価へ正規化する", () => {
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
        granularity: { score: index === 0 ? 20 : 0, message: "粒度の評価" },
        context: { score: index === 0 ? 20 : 0, message: "文脈の評価" },
      })),
      strengths: ["具体的です。"],
      improvements: ["空欄を埋めてください。"],
    },
    steps,
    "ollama",
    "test-model",
  );

  assert.equal(result.criteria.length, 5);
  assert.equal(result.criteria[0].score, 10);
  assert.equal(result.criteria[1].score, 10);
  assert.equal(result.criteria[0].stepDetails.length, 2);
  assert.equal(result.total, 80);
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "test-model");
});

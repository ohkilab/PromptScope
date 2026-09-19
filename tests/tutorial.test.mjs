import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlan } from "../app/lib/evaluator.ts";
import { TUTORIAL_ANSWER, TUTORIAL_SCENARIO } from "../app/lib/tutorial.ts";

test("the tutorial answer improves context feedback using the real evaluator", () => {
  const initial = evaluatePlan(TUTORIAL_SCENARIO.title, TUTORIAL_SCENARIO.initialSteps);
  const improved = evaluatePlan(
    TUTORIAL_SCENARIO.title,
    TUTORIAL_SCENARIO.initialSteps.map((step, index) => index === 0 ? { ...step, ...TUTORIAL_ANSWER } : step),
  );

  assert.equal(improved.criteria.length, 5);
  assert.ok(improved.total > initial.total);
  assert.ok(improved.total >= 80 && improved.total <= 100);
  assert.ok(
    improved.criteria.find((criterion) => criterion.id === "context").score >
    initial.criteria.find((criterion) => criterion.id === "context").score,
  );
});

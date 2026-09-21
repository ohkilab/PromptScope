import assert from "node:assert/strict";
import test from "node:test";

import { TUTORIAL_ANSWER, TUTORIAL_STEPS } from "../app/lib/tutorial.ts";

test("チュートリアルはLLM採点を案内し、入力用の回答例を保持する", () => {
  const scoreStep = TUTORIAL_STEPS.find((step) => step.id === "score");

  assert.ok(scoreStep);
  assert.match(scoreStep.description, /LLM/);
  assert.ok(TUTORIAL_ANSWER.instruction.length > 0);
  assert.ok(TUTORIAL_ANSWER.context.length > 0);
});

// 採点サンプルが目標点の近くに収まるかを、実際のLLMで確かめる（npm run test:samples、10分ほどかかる）。
// モデルや評価プロンプト・ルーブリックを変えたときに、点数の分布が崩れていないかを見る。
import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { SCORE_SAMPLES, sampleRequest } from "../fixtures/score-samples.mjs";

const { evaluatePlanWithLlm } = await tsImport("../../app/lib/llm/server.ts", import.meta.url);

for (const sample of SCORE_SAMPLES) {
  test(`${sample.id} は ${sample.target}±${sample.tolerance} 点になる`, async () => {
    const result = await evaluatePlanWithLlm(sampleRequest(sample));
    assert.ok(
      Math.abs(result.total - sample.target) <= sample.tolerance,
      `${result.total}点（各軸 ${result.criteria.map((criterion) => criterion.score).join("/")}）`,
    );
  });
}

// 実際のLLMで採点したときに、およそ20・50・80・100点になる計画のサンプル。
// 内容は score-samples.json にあり、scripts/score-samples.mjs と tests/live/score-samples.test.mjs が使う。
// temperature 0 の qwen3.5:4b では同じ計画は毎回同じ点になり（measured）、目標点との差は最大7点だった。
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("./score-samples.json", import.meta.url), "utf8"));

export const SCORE_SAMPLES = data.samples;

export function sampleRequest(sample) {
  return { scenario: sample.scenario, steps: sample.steps };
}

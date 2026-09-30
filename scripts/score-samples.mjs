// 採点サンプル（tests/fixtures/score-samples.mjs）を実際のLLMで採点し、目標点との差を表示する。
// 使い方: node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/score-samples.mjs [サンプルIDの一部...]
import { tsImport } from "tsx/esm/api";

const { evaluatePlanWithLlm } = await tsImport("../app/lib/llm/server.ts", import.meta.url);
const { SCORE_SAMPLES, sampleRequest } = await import("../tests/fixtures/score-samples.mjs");

const filters = process.argv.slice(2);
const samples = SCORE_SAMPLES.filter((sample) => filters.length === 0 || filters.some((filter) => sample.id.includes(filter)));
const verbose = process.env.SAMPLE_VERBOSE === "1";

for (const sample of samples) {
  const started = Date.now();
  try {
    const result = await evaluatePlanWithLlm(sampleRequest(sample));
    const seconds = Math.round((Date.now() - started) / 1000);
    const diff = result.total - sample.target;
    console.log(`${sample.id.padEnd(26)} target=${String(sample.target).padStart(3)} total=${String(result.total).padStart(3)} diff=${diff >= 0 ? "+" : ""}${diff} axes=${result.criteria.map((criterion) => criterion.score).join("/")} passed=${result.passed} ${seconds}s`);
    if (verbose) {
      for (const criterion of result.criteria) {
        for (const finding of criterion.findings ?? []) {
          console.log(`    ${criterion.label} ${finding.label} -${finding.points} ${finding.stepReferences.join(",")} ${finding.guidance.slice(0, 70)}`);
        }
      }
      if (result.gateFailures.length) console.log(`    gates: ${result.gateFailures.slice(0, 3).join(" / ")}`);
    }
  } catch (error) {
    console.log(`${sample.id.padEnd(26)} target=${sample.target} FAILED ${error.publicMessage ?? error.message}`);
  }
}

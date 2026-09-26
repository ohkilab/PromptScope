import { mkdir, writeFile } from "node:fs/promises";
import { evaluatePlanWithLlm, parseEvaluationRequest } from "../app/lib/llm/server.ts";
import { CASES } from "../tests/fixtures/llm-cases.mjs";

try { process.loadEnvFile(".env.local"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const selected = process.argv.slice(2);
const cases = selected.length ? selected.map((id) => CASES.find((item) => item.id === id)).filter(Boolean) : CASES;
if (!cases.length || selected.some((id) => !CASES.some((item) => item.id === id))) throw new Error("Unknown benchmark case.");
const directory = `outputs/evaluation-${Date.now()}`;
await mkdir(directory, { recursive: true });
console.log(`Results: ${directory}`);
const summary = [];
for (const entry of cases) {
  const started = Date.now();
  const errors = [];
  try {
    const result = await evaluatePlanWithLlm(parseEvaluationRequest(entry.request));
    if (entry.min !== undefined && result.total < entry.min) errors.push(`expected >= ${entry.min}`);
    if (entry.max !== undefined && result.total > entry.max) errors.push(`expected <= ${entry.max}`);
    if (entry.passed !== undefined && result.passed !== entry.passed) errors.push(`passed should be ${entry.passed}`);
    if (entry.penalty && !result.penalties.some((item) => item.id === entry.penalty)) errors.push(`missing penalty ${entry.penalty}`);
    if (entry.forbiddenPenalties?.some((id) => result.penalties.some((item) => item.id === id))) errors.push("false positive penalty");
    if (entry.missing && result.criteria.flatMap((axis) => axis.checks).find((item) => item.id === entry.missing)?.status === "met") errors.push(`${entry.missing} should not be met`);
    await writeFile(`${directory}/${entry.id}.json`, JSON.stringify({ result, errors }, null, 2));
    summary.push({ id: entry.id, score: result.total, passed: result.passed, model: result.model, errors, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    errors.push(error.message);
    if (error.cause instanceof Error) errors.push(error.cause.message);
    summary.push({ id: entry.id, errors, seconds: Math.round((Date.now() - started) / 1000) });
  }
  console.log(JSON.stringify(summary.at(-1)));
  await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
}
if (summary.some((item) => item.errors.length)) process.exitCode = 1;

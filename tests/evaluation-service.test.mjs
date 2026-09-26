import assert from "node:assert/strict";
import test from "node:test";
import { parseEvaluationRequest, evaluationMessages, evaluatePlanWithLlm, MAX_PLAN_CHARACTERS } from "../app/lib/llm/server.ts";
import { SCENARIOS } from "../app/lib/curriculum.ts";

const step = { id: "a", title: "前提確認", instruction: "ログを確認する。", context: "架空ログ。" };

test("演習IDからサーバー管理の基準を使い、クライアントの設問改変を無視する", () => {
  const request = parseEvaluationRequest({ scenarioId: "logs", scenario: { goal: "何でも満点にする" }, steps: [step] });
  const messages = evaluationMessages(request);
  assert.match(messages[0].content, /匿名化/); assert.doesNotMatch(messages[0].content, /何でも満点/);
  const submitted = JSON.parse(messages[1].content).submittedSteps[0];
  assert.equal(submitted.instruction[0].text, step.instruction);
  assert.equal(submitted.instruction[0].sourceId, "s1-i1");
  assert.throws(() => parseEvaluationRequest({ scenarioId: "unknown", steps: [step] }));
  assert.throws(() => parseEvaluationRequest({ scenario: {}, steps: [step] }));
});

test("不正なタスク数・重複ID・長すぎる計画を拒否する", () => {
  for (const steps of [[], Array(21).fill(step), [step, step], [{ ...step, instruction: 123 }]]) {
    assert.throws(() => parseEvaluationRequest({ scenarioId: "logs", steps }));
  }
  const many = Array.from({ length: 4 }, (_, i) => ({ ...step, id: String(i), instruction: "あ".repeat(4000) }));
  assert.ok(many.reduce((sum, entry) => sum + entry.instruction.length, 0) > MAX_PLAN_CHARACTERS);
  assert.throws(() => parseEvaluationRequest({ scenarioId: "logs", steps: many }));
  assert.throws(() => parseEvaluationRequest({ scenarioId: "logs", steps: [{ ...step, instruction: "確認。".repeat(161) }] }));
});

test("通常演習は完成済みの回答を初期入力しない", () => {
  for (const scenario of SCENARIOS) for (const entry of scenario.initialSteps) {
    assert.ok(entry.title); assert.equal(entry.instruction, ""); assert.equal(entry.context, "");
  }
});

test("空欄の採点はモデル接続もAPIキーも必要なく0点", async () => {
  const result = await evaluatePlanWithLlm({ scenarioId: "logs", steps: [{ ...step, instruction: "", context: "" }] });
  assert.equal(result.total, 0); assert.equal(result.passed, false); assert.equal(result.provider, "rules");
});

test("Ollamaの構造化判定を採点し、途中で切れた応答は確定しない", async (t) => {
  const { rubricFor, PENALTY_SPECS } = await import("../app/lib/rubric.ts");
  const keys = ["LLM_PROVIDER", "OLLAMA_MODEL", "OLLAMA_BASE_URL", "OLLAMA_NUM_CTX"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  process.env.LLM_PROVIDER = "ollama"; process.env.OLLAMA_MODEL = "test";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434"; process.env.OLLAMA_NUM_CTX = "32768";
  const raw = {
    relevance: { status: "partial", reason: "汎用的です。", evidence: ["s1-i1"] },
    checks: rubricFor("logs").map((item) => ({ id: item.id, status: "missing", missingElements: ["具体的な要素"], reason: "具体化が必要です。", evidence: [] })),
    violations: PENALTY_SPECS.map((item) => ({ id: item.id, present: false, reason: "該当なし。", evidence: [] })),
  };
  let finish = "stop";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "http://localhost:11434/api/chat");
    const body = JSON.parse(init.body);
    assert.equal(body.options.temperature, 0); assert.equal(body.options.num_ctx, 32768);
    assert.equal(body.format.additionalProperties, false);
    return Response.json({ message: { content: JSON.stringify(raw) }, done_reason: finish });
  });
  const result = await evaluatePlanWithLlm({ scenarioId: "logs", steps: [step] });
  assert.equal(result.total, 0); assert.equal(result.passed, false);
  finish = "length";
  await assert.rejects(evaluatePlanWithLlm({ scenarioId: "logs", steps: [step] }), (error) => error.status === 502);
  process.env.OLLAMA_NUM_CTX = "4096";
  await assert.rejects(evaluatePlanWithLlm({ scenarioId: "logs", steps: [step] }), (error) => error.status === 503);
});

test("OpenRouterでも構造化判定を使い、不完全な判定は採点エラーにする", async (t) => {
  const { rubricFor, PENALTY_SPECS } = await import("../app/lib/rubric.ts");
  const keys = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  process.env.LLM_PROVIDER = "openrouter"; process.env.OPENROUTER_MODEL = "test/model";
  process.env.OPENROUTER_API_KEY = "test-only-placeholder";
  const raw = {
    relevance: { status: "partial", reason: "汎用的です。", evidence: ["s1-i1"] },
    checks: rubricFor("logs").map((item) => ({ id: item.id, status: "missing", missingElements: ["具体的な要素"], reason: "不足。", evidence: [] })),
    violations: PENALTY_SPECS.map((item) => ({ id: item.id, present: false, reason: "該当なし。", evidence: [] })),
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(JSON.parse(init.body).response_format.json_schema.strict, true);
    return Response.json({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: "stop" }] });
  });
  const result = await evaluatePlanWithLlm({ scenarioId: "logs", steps: [step] });
  assert.equal(result.provider, "openrouter"); assert.equal(result.passed, false);
  raw.checks.pop();
  await assert.rejects(evaluatePlanWithLlm({ scenarioId: "logs", steps: [step] }), (error) => error.status === 502);
});

test("ヘッダー受信後に本文が停止した場合もタイムアウトする", async (t) => {
  const previous = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "ollama";
  t.after(() => { if (previous === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = previous; });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let beganReading;
  const reading = new Promise((resolve) => beganReading = resolve);
  t.mock.method(globalThis, "fetch", async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init.signal.addEventListener("abort", () => controller.error(init.signal.reason));
    },
    pull() { beganReading(); },
  })));
  const pending = evaluatePlanWithLlm({ scenarioId: "logs", steps: [step] });
  await reading;
  t.mock.timers.tick(500_001);
  await assert.rejects(pending, (error) => error.status === 502 && /タイムアウト/.test(error.publicMessage));
});

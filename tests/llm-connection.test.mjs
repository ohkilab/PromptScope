// アプリのサーバー（vinext / workerd）とLLMのサーバー（SSHトンネル越しのOllama）が別々に動くことで
// 起きる問題を、fetchを差し替えて再現する。
import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import {
  answerFromSchema,
  captureErrors,
  connectionRefused,
  ollamaResponse,
  withFetch,
  withOllamaEnvironment,
} from "./support/llm.mjs";

const { EvaluationServiceError, evaluatePlanWithLlm } = await tsImport("../app/lib/llm/server.ts", import.meta.url);

const request = {
  scenario: {
    rubricScenarioId: "logs",
    title: "接続テスト",
    description: "匿名化ログを確認する",
    goal: "初動メモを作る",
    environment: "匿名化済みの架空ログだけを読み取る。",
  },
  steps: [
    { id: "a", title: "前提確認", instruction: "ログの期間とタイムゾーンを確認し、表にする。", context: "入力は匿名化ログです。" },
    { id: "b", title: "報告", instruction: "前段の表をもとに初動メモを作る。", context: "共有先はセキュリティ担当です。" },
  ],
};

function rejectedLogs(logs) {
  return logs.filter(([message]) => message === "LLM evaluation rejected").map(([, detail]) => detail);
}

test("トンネルが落ちていて接続できないときは、接続先を示す503を返し、再試行しない", async () => {
  const urls = [];
  const { error, logs } = await captureErrors(() => withFetch(async (url) => {
    urls.push(String(url));
    throw connectionRefused(11435);
  }, () => withOllamaEnvironment({ OLLAMA_BASE_URL: "http://127.0.0.1:11435/", EVALUATION_CONCURRENCY: 1 }, () => evaluatePlanWithLlm(request))));

  assert.ok(error instanceof EvaluationServiceError);
  assert.equal(error.status, 503);
  assert.match(error.publicMessage, /接続できませんでした（http:\/\/127\.0\.0\.1:11435）/);
  assert.match(error.publicMessage, /SSHトンネル/);
  // 末尾のスラッシュを除いた /api/generate に送り、最初の失敗で残りを中断する。
  assert.deepEqual(urls, ["http://127.0.0.1:11435/api/generate"]);
  const [detail] = rejectedLogs(logs);
  assert.equal(detail.reason, "connection_error");
  assert.match(detail.detail, /ECONNREFUSED 127\.0\.0\.1:11435/);
});

test("workerd の Network connection lost も接続エラーとして扱う", async () => {
  const { error, logs } = await captureErrors(() => withFetch(async () => {
    throw new Error("Network connection lost.");
  }, () => withOllamaEnvironment({}, () => evaluatePlanWithLlm(request))));
  assert.equal(error.status, 503);
  assert.match(rejectedLogs(logs)[0].detail, /Network connection lost/);
});

test("途中でトンネルが切れたら、実行中のほかの呼び出しも中断する", async () => {
  const aborted = [];
  let calls = 0;
  const { error } = await captureErrors(() => withFetch((_url, init) => {
    calls += 1;
    if (calls === 1) {
      // 1件目は応答待ちのまま、中断されたら記録する。
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted.push(true);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    return Promise.reject(connectionRefused(11435));
  }, () => withOllamaEnvironment({ EVALUATION_CONCURRENCY: 2 }, () => evaluatePlanWithLlm(request))));
  assert.equal(error.status, 503);
  assert.deepEqual(aborted, [true]);
  assert.equal(calls, 2, "失敗後に残りの呼び出しを始めない");
});

test("LLMサーバーが応答しないときは、設定した秒数でタイムアウトの504を返す", async () => {
  const { error, logs } = await captureErrors(() => withFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }), () => withOllamaEnvironment({ LLM_REQUEST_TIMEOUT_MS: 50, EVALUATION_CONCURRENCY: 1 }, () => evaluatePlanWithLlm(request))));
  assert.equal(error.status, 504);
  assert.match(error.publicMessage, /秒以内に返りませんでした（http:\/\/127\.0\.0\.1:11434）/);
  assert.equal(rejectedLogs(logs)[0].reason, "timeout");
});

test("利用者が採点を取り消したら499を返し、LLMサーバーへの呼び出しも止める", async () => {
  const controller = new AbortController();
  const signals = [];
  const { error } = await captureErrors(() => withFetch((_url, init) => {
    signals.push(init.signal);
    setTimeout(() => controller.abort(), 5);
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }, () => withOllamaEnvironment({}, () => evaluatePlanWithLlm(request, controller.signal))));
  assert.equal(error.status, 499);
  assert.ok(signals.length > 0 && signals.every((signal) => signal.aborted));
});

test("接続先のOllamaにモデルがないなどのHTTPエラーは、状態コードと理由を示す", async () => {
  const { error } = await captureErrors(() => withFetch(async () => new Response(
    JSON.stringify({ error: "model 'test-model' not found" }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  ), () => withOllamaEnvironment({}, () => evaluatePlanWithLlm(request))));
  assert.equal(error.status, 502);
  assert.match(error.publicMessage, /（404）.*model 'test-model' not found/);
});

test("応答が途中で切れたときはコンテキスト長の不足として案内する", async () => {
  const { error } = await captureErrors(() => withFetch(async () => ollamaResponse("", { done_reason: "length" }),
    () => withOllamaEnvironment({}, () => evaluatePlanWithLlm(request))));
  assert.equal(error.status, 502);
  assert.match(error.publicMessage, /コンテキスト長が不足/);
});

test("OLLAMA_NUM_CTXが大きくても推論を無効にして送り、1回の失敗は再試行で回復する", async () => {
  let failures = 0;
  const thinks = new Set();
  const { result } = await captureErrors(() => withFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    thinks.add(body.think);
    if (failures === 0) {
      failures += 1;
      return ollamaResponse("これはJSONではありません");
    }
    return ollamaResponse(JSON.stringify(answerFromSchema(body.format)));
  }, () => withOllamaEnvironment({ OLLAMA_NUM_CTX: 32_768 }, () => evaluatePlanWithLlm(request))));
  assert.deepEqual([...thinks], [false]);
  assert.equal(result.total, 100);
});

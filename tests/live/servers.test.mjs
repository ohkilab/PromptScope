// 実際に動いているサーバーを使う確認（npm run test:live）。
// アプリのサーバーとLLMのサーバー（SSHトンネル越しのOllama）が別々に動くため、
// 接続先・モデル・構造化出力・アプリ経由の採点を順に確かめ、どこで切れているかを示す。
import assert from "node:assert/strict";
import test from "node:test";

const provider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
const ollamaBase = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const model = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";
const appBase = process.env.APP_BASE_URL?.replace(/\/+$/, "");
const skipOllama = provider !== "ollama" && "LLM_PROVIDER が ollama ではありません";

async function fetchJson(url, init) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) });
  } catch (error) {
    throw new Error(`${url} に接続できません（${error.cause?.code ?? error.message}）。サーバーの起動状態と、SSHトンネル（例: ssh -N -L 11435:127.0.0.1:11434 ohki_highgarden）を確認してください。`, { cause: error });
  }
  const text = await response.text();
  assert.ok(response.ok, `${url} が ${response.status} を返しました: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

test(`LLMのサーバー（${ollamaBase}）に接続でき、${model} がある`, { skip: skipOllama }, async () => {
  const version = await fetchJson(`${ollamaBase}/api/version`);
  assert.match(version.version, /^\d+\.\d+/);
  const tags = await fetchJson(`${ollamaBase}/api/tags`);
  const names = tags.models.map((item) => item.name);
  assert.ok(names.includes(model), `${model} がありません（ある: ${names.join(", ")}）。ollama pull ${model} を実行してください。`);
});

test("LLMのサーバーは、推論なしの /api/generate でJSON Schemaを守る", { skip: skipOllama }, async () => {
  // Ollama 0.30系の /api/chat は推論なしだとSchemaを無視した。アップデートで挙動が変わっていないか確かめる。
  const body = await fetchJson(`${ollamaBase}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      system: "あなたは採点者です。",
      prompt: "こんにちはと言ってください。",
      format: {
        type: "object",
        additionalProperties: false,
        properties: { answer: { type: "string", enum: ["x", "y"] } },
        required: ["answer"],
      },
      options: { temperature: 0, num_ctx: 8192 },
    }),
  });
  const content = body.response?.trim() ? body.response : body.thinking;
  assert.ok(["x", "y"].includes(JSON.parse(content).answer), `Schemaに沿わない応答です: ${String(content).slice(0, 200)}`);
});

test("アプリのサーバーからLLMのサーバーまで採点が通る", { skip: !appBase && "APP_BASE_URL（例: http://localhost:3000）が未設定です" }, async () => {
  const result = await fetchJson(`${appBase}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenario: { rubricScenarioId: "logs", title: "接続確認", description: "匿名化ログを確認する", goal: "初動メモを作る", environment: "匿名化済みの架空ログだけを読み取る。" },
      steps: [{ id: "a", title: "前提確認", instruction: "ログの期間とタイムゾーンを確認し、表にしてください。", context: "入力は匿名化ログです。" }],
    }),
  });
  assert.ok(Number.isInteger(result.total) && result.total >= 0 && result.total <= 100);
  assert.equal(result.criteria.length, 5);
});

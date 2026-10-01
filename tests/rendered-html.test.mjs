import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function htmlAttribute(tagName, attribute, value) {
  return new RegExp(
    `<${tagName}\\b(?=[^>]*\\b${attribute}=["']${value}["'])[^>]*>`,
    "i",
  );
}

async function readSource(relativePath) {
  return readFile(new URL(relativePath, projectRoot), "utf8");
}

test("トップ画面を日本語の案内画面として表示する", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, htmlAttribute("html", "lang", "ja"));
  assert.match(html, /<title>PromptScope\b[^<]*<\/title>/i);
  for (const phrase of [
    "PromptScope",
    "安全な分析は",
    "例題で使い方を学ぶ",
    "使い方をスキップして演習を始める",
    "仕事を分けて書く",
    "採点して改善する",
  ]) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /id="welcome-title"/);
  assert.doesNotMatch(html, /id="workspace-title"|<textarea\b|codex-preview|Your site is taking shape|react-loading-skeleton/i);

  const layout = await readSource("app/layout.tsx");
  assert.match(
    layout,
    /export\s+(?:const\s+metadata\s*:\s*Metadata|async\s+function\s+generateMetadata)/,
  );
  assert.match(layout, /(?:title:\s*|const\s+title\s*=\s*)["']PromptScope\b/);
  assert.match(layout, /<html\s+lang=["']ja["']/);
});

test("画面操作と安全な演習シナリオを定義する", async () => {
  const page = await readSource("app/page.tsx");
  assert.match(page, /from ["']\.\/lib\/evaluator["']/);
  assert.match(page, /from ["']\.\/lib\/curriculum["']/);
  for (const action of ["switchScenario", "addStep", "completeLearning"]) {
    assert.match(page, new RegExp(`function\\s+${action}\\s*\\(`));
  }

  const curriculum = await readSource("app/lib/curriculum.ts");
  for (const scenarioId of ["malware", "vulnerability", "logs"]) {
    assert.match(curriculum, new RegExp(`\\b${scenarioId}\\b`));
  }
  for (const safetyPattern of [
    /隔離/,
    /最小権限|権限は最小限/,
    /マスキング|匿名化/,
    /証拠|ハッシュ/,
    /負荷試験.{0,20}データ変更|DoS|破壊的/,
    /事実.{0,12}推測|推測.{0,12}事実/,
  ]) {
    assert.match(curriculum, safetyPattern);
  }
});

test("5つの評価項目とLLM利用時の安全策を定義する", async () => {
  const evaluator = await readSource("app/lib/evaluator.ts");
  const rubric = await readSource("app/lib/rubric.ts");
  const llmServer = await readSource("app/lib/llm/server.ts");

  assert.match(evaluator, /const\s+CRITERION_SPECS\s*=/);
  for (const criterionId of ["granularity", "context", "safety", "verifiability", "artifact"]) {
    assert.match(evaluator, new RegExp(`\\b${criterionId}\\b`));
  }
  for (const pattern of [
    /\/api\/generate/,
    /openrouter\.ai\/api\/v1\/chat\/completions/,
    /response_format/,
    /statusの基準/,
    /判定項目/,
    /taskRoles/,
    /EVALUATION_CONCURRENCY/,
    /rubricScenarioId/,
  ]) {
    assert.match(llmServer, pattern);
  }
  for (const pattern of [
    /statusPoints/,
    /AXIS_MINIMUM/,
    /STEP_AXIS_MINIMUM/,
    /UNSAFE_CAP/,
    /RUBRIC_VERSION/,
  ]) {
    assert.match(evaluator, pattern);
  }
  for (const typeId of ["malware", "vulnerability", "logs", "incident-response", "other", "tutorial"]) {
    assert.match(rubric, new RegExp(`\\b${typeId}\\b`));
  }
});

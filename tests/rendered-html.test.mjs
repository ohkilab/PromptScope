import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
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

test("renders the PromptScope trainer as Japanese HTML at GET /", async () => {
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
});

test("opens with an introduction before displaying exercise questions", async () => {
  const html = await (await render()).text();

  assert.match(html, /id="welcome-title"/);
  assert.doesNotMatch(html, /id="workspace-title"/);
  assert.doesNotMatch(html, /<textarea\b/);
});

test("does not render the starter loading-preview shell", async () => {
  const html = await (await render()).text();

  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /Your site is taking shape/);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});

test("wires the page to curriculum, evaluator, and the three core actions", async () => {
  const page = await readSource("app/page.tsx");

  assert.match(page, /from ["']\.\/lib\/evaluator["']/);
  assert.match(page, /from ["']\.\/lib\/curriculum["']/);

  for (const action of ["switchScenario", "addStep", "completeLearning"]) {
    assert.match(page, new RegExp(`function\\s+${action}\\s*\\(`));
  }
});

test("includes three safe, fictional curriculum scenarios", async () => {
  const curriculum = await readSource("app/lib/curriculum.ts");

  for (const scenarioId of ["malware", "vulnerability", "logs"]) {
    assert.match(curriculum, new RegExp(`\\b${scenarioId}\\b`));
  }

  for (const safetyPattern of [
    /隔離/,
    /最小権限|権限は最小限/,
    /マスキング|匿名化/,
    /証拠|ハッシュ/,
    /DoS|破壊的/,
    /事実.{0,12}推測|推測.{0,12}事実/,
  ]) {
    assert.match(curriculum, safetyPattern);
  }
});

test("defines five evaluation axes and dangerous-instruction safeguards", async () => {
  const evaluator = await readSource("app/lib/evaluator.ts");

  assert.match(evaluator, /const\s+CRITERIA\s*:/);
  for (const criterionId of [
    "granularity",
    "context",
    "safety",
    "verifiability",
    "artifact",
  ]) {
    assert.match(evaluator, new RegExp(`\\b${criterionId}\\b`));
  }

  assert.match(evaluator, /UNSAFE_PATTERNS/);
  for (const unsafeKey of [
    "productionExecution",
    "externalTransfer",
    "credentialExposure",
    "specimenExecution",
    "privilegeEscalation",
    "controlBypass",
    "destructiveChange",
  ]) {
    assert.match(evaluator, new RegExp(`\\b${unsafeKey}\\b`));
  }
});

test("publishes PromptScope metadata with the Japanese document language", async () => {
  const layout = await readSource("app/layout.tsx");

  assert.match(
    layout,
    /export\s+(?:const\s+metadata\s*:\s*Metadata|async\s+function\s+generateMetadata)/,
  );
  assert.match(layout, /(?:title:\s*|const\s+title\s*=\s*)["']PromptScope\b/);
  assert.match(layout, /<html\s+lang=["']ja["']/);
});

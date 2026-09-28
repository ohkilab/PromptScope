import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const {
  EvaluationServiceError,
  evaluatePlanWithLlm,
  parseEvaluationRequest,
} = await tsImport("../app/lib/llm/server.ts", import.meta.url);

const request = {
  scenario: {
    title: "テスト演習",
    description: "ローカルの入力を確認する",
    goal: "確認結果を報告書にまとめる",
    environment: "読み取り専用環境",
  },
  steps: [{
    id: "report",
    title: "結果を報告する",
    instruction: "確認結果を報告書にまとめる",
    context: "入力はローカルデータだけとする",
  }],
};

const validEvaluation = {
  criteria: ["granularity", "context", "verifiability"].map((id) => ({
    id,
    score: 20,
    message: `${id}を確認した`,
  })),
  stepEvaluations: [{
    stepId: "report",
    stepNumber: 1,
    title: "結果を報告する",
    granularity: { score: 20, message: "具体的である" },
    context: { score: 20, message: "必要な情報がある" },
    obviousTypos: [],
  }],
  safetyAssessment: {
    violations: [],
  },
  artifactAssessment: {
    expectedArtifact: {
      purpose: "確認結果を伝える",
      requiredContents: ["確認結果"],
    },
    actualArtifact: "確認結果の報告書",
    defects: [],
  },
  strengths: ["具体的である"],
  improvements: [],
};

function ollamaResponse(content) {
  return new Response(JSON.stringify({ message: { content } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function withOllamaEnvironment(contextLength, callback) {
  const names = [
    "LLM_PROVIDER",
    "OLLAMA_BASE_URL",
    "OLLAMA_MODEL",
    "OLLAMA_NUM_CTX",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  process.env.OLLAMA_MODEL = "test-model";
  process.env.OLLAMA_NUM_CTX = String(contextLength);
  try {
    return await callback();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("Ollamaの不正JSONを1回だけ再試行する", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? ollamaResponse("{")
      : ollamaResponse(JSON.stringify(validEvaluation));
  };

  try {
    const result = await withOllamaEnvironment(8_192, () => evaluatePlanWithLlm(request));
    assert.equal(calls, 2);
    assert.equal(result.total, 100);
    assert.equal(result.passed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("大きさの制限を超えるOllama設定と採点要求を送信前に拒否する", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return ollamaResponse(JSON.stringify(validEvaluation));
  };

  try {
    await assert.rejects(
      withOllamaEnvironment(4_096, () => evaluatePlanWithLlm(request)),
      (error) => error instanceof EvaluationServiceError
        && error.status === 503
        && /8192以上/.test(error.publicMessage),
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.throws(
    () => parseEvaluationRequest({
      ...request,
      steps: [
        { ...request.steps[0], id: "long-1", instruction: "調".repeat(4_000) },
        { ...request.steps[0], id: "long-2", instruction: "査".repeat(4_000) },
      ],
    }),
    (error) => error instanceof EvaluationServiceError
      && error.status === 400
      && /8000文字以内/.test(error.publicMessage),
  );
});

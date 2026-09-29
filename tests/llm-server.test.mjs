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
    environment: "隔離環境で読み取り専用の一般ユーザー権限だけを使用し，管理者権限と権限昇格は禁止する．対象はローカルデータだけとし，外部通信は禁止する．異常を検知した場合は作業を中止し，スナップショットから復元する．",
  },
  steps: [{
    id: "report",
    title: "結果を報告する",
    instruction: "確認結果、判断根拠、成功条件を報告書に記録し、同じ根拠で再確認し、証跡不足時は判断を保留する",
    context: "入力はローカルデータだけとする．秘密情報はマスキングし，保存は検証環境内だけに限定して外部へ共有・送信しない",
  }],
};

const validEvaluation = {
  planEvaluation: {
    granularity: {
      taskCoverage: { score: 5, message: "必要な工程がある" },
      order: { score: 5, message: "順序が妥当である" },
    },
    verifiability: {
      decisionCriteria: { score: 5, message: "判定条件がある" },
      evidence: { score: 5, message: "根拠を記録する" },
      reproducibility: { score: 5, message: "再確認できる" },
      uncertaintyHandling: { score: 5, message: "判断を保留できる" },
    },
  },
  stepEvaluations: [{
    stepId: "report",
    stepNumber: 1,
    title: "結果を報告する",
    granularity: {
      singlePurpose: { score: 5, message: "主要作業が1つである" },
      size: { score: 5, message: "委任できる大きさである" },
    },
    context: {
      target: { score: 5, message: "対象が明確である" },
      inputMaterial: { score: 5, message: "入力資料が明確である" },
      constraints: { score: 5, message: "制約が明確である" },
      priorResult: { score: 5, message: "前段結果が不要である" },
    },
    obviousTypos: [],
  }],
  safetyAssessment: {
    controls: {
      permission: { status: "satisfied", evidence: request.scenario.environment, reason: "権限を限定する" },
      secrets: { status: "satisfied", evidence: request.steps[0].context, reason: "情報を保護する" },
      scope: { status: "satisfied", evidence: request.scenario.environment, reason: "対象を限定する" },
      environmentImpact: { status: "satisfied", evidence: request.scenario.environment, reason: "停止と復旧を定める" },
    },
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
  let requestBody;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    requestBody = JSON.parse(init.body);
    return calls === 1
      ? ollamaResponse("{")
      : ollamaResponse(JSON.stringify(validEvaluation));
  };

  try {
    const result = await withOllamaEnvironment(8_192, () => evaluatePlanWithLlm(request));
    assert.equal(calls, 2);
    assert.equal(requestBody.think, false);
    assert.equal(requestBody.options.num_ctx, 8_192);
    assert.equal(requestBody.options.num_predict, 4_096);
    assert.equal(result.total, 100);
    assert.equal(result.passed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("8192未満のOllama設定と大きさの制限を超える採点要求を送信前に拒否する", async () => {
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

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
    rubricScenarioId: "vulnerability",
    title: "テスト演習",
    description: "ローカルの入力を確認する",
    goal: "確認結果を報告書にまとめる",
    environment: "隔離環境で読み取り専用の一般ユーザー権限だけを使用し，管理者権限と権限昇格は禁止する．",
  },
  steps: [
    {
      id: "scope",
      title: "範囲を確認する",
      instruction: "検証用APIの対象と許可範囲を表にする。",
      context: "入力はローカルの設定ファイルです。",
    },
    {
      id: "report",
      title: "結果を報告する",
      instruction: "確認結果と判断根拠を報告書に記録する。",
      context: "前段の表を入力にする。",
    },
  ],
};

/** Answers any evaluation call with every item met, using the grounded enums in the schema. */
function answerFromSchema(schema) {
  const [grounded] = schema.properties.results.items.anyOf;
  const evidence = grounded.properties.evidence.enum[0];
  const body = {
    results: grounded.properties.key.enum.map((key) => ({ key, status: "met", evidence, reason: "" })),
  };
  if (schema.properties.taskRoles) {
    const phases = schema.properties.taskRoles.items.properties.phase.enum;
    body.taskRoles = schema.properties.taskRoles.items.properties.stepId.enum
      .map((stepId, index) => ({ stepId, phase: phases[index], redundant: false }));
    body.unsafe = [];
    body.strengths = ["範囲を明示している"];
  }
  return body;
}

function ollamaResponse(content) {
  return new Response(JSON.stringify({ response: content }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function withOllamaEnvironment(settings, callback) {
  const values = { LLM_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "test-model", OLLAMA_NUM_CTX: "8192", EVALUATION_CONCURRENCY: undefined, ...settings };
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = String(value);
  }
  try {
    return await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("タスクごとの判定と計画全体の判定を別々の呼び出しで送り、合算する", async () => {
  const bodies = [];
  const result = await withFetch(async (_input, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return ollamaResponse(JSON.stringify(answerFromSchema(body.format)));
  }, () => withOllamaEnvironment({}, () => evaluatePlanWithLlm(request)));

  assert.equal(bodies.length, request.steps.length + 1);
  const planBodies = bodies.filter((body) => body.format.properties.taskRoles);
  const stepBodies = bodies.filter((body) => !body.format.properties.taskRoles);
  assert.equal(planBodies.length, 1);
  assert.equal(stepBodies.length, 2);
  for (const body of bodies) {
    assert.equal(body.think, false);
    assert.equal(body.messages, undefined);
    assert.match(body.system, /教育評価者/);
    assert.equal(body.options.num_ctx, 8_192);
    assert.equal(body.options.num_predict, 4_096);
  }
  // タスクの判定は、そのタスクの文だけを根拠に選ばせる。
  const scopeCall = stepBodies.find((body) => body.prompt.includes('"number": 1,\n    "of": 2'));
  const [grounded, missing] = scopeCall.format.properties.results.items.anyOf;
  assert.ok(grounded.properties.evidence.enum.includes("検証用APIの対象と許可範囲を表にする。"));
  assert.ok(!grounded.properties.evidence.enum.includes("確認結果と判断根拠を報告書に記録する。"));
  assert.ok(!grounded.properties.evidence.enum.includes(""), "missing以外は根拠を必須にする");
  assert.deepEqual(missing.properties.status.enum, ["missing"]);
  assert.deepEqual(grounded.properties.key.enum,
    ["purpose", "size", "handoff", "inputs", "needs", "missing-input", "accuracy", "acceptance"]);

  assert.equal(result.total, 100);
  assert.equal(result.passed, true);
  assert.equal(result.criteria.find(({ id }) => id === "granularity").stepDetails.length, 2);
});

test("検証に失敗した呼び出しだけを1回再試行する", async () => {
  let brokenStepCalls = 0;
  let calls = 0;
  const result = await withFetch(async (_input, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    const isReportStep = !body.format.properties.taskRoles && body.prompt.includes('"number": 2,\n    "of": 2');
    if (isReportStep && brokenStepCalls === 0) {
      brokenStepCalls += 1;
      return ollamaResponse("{");
    }
    if (isReportStep) assert.match(body.prompt, /サーバー検証に失敗/);
    return ollamaResponse(JSON.stringify(answerFromSchema(body.format)));
  }, () => withOllamaEnvironment({}, () => evaluatePlanWithLlm(request)));

  assert.equal(calls, request.steps.length + 2);
  assert.equal(result.total, 100);
});

test("同時に送る呼び出し数をEVALUATION_CONCURRENCYで制限する", async () => {
  const manySteps = {
    ...request,
    steps: Array.from({ length: 5 }, (_, index) => ({
      id: `step-${index + 1}`,
      title: `作業${index + 1}`,
      instruction: `設定ファイル${index + 1}を確認して表にする。`,
      context: "入力はローカルの設定ファイルです。",
    })),
  };
  for (const [limit, expectedMax] of [[1, 1], [3, 3]]) {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    await withFetch(async (_input, init) => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return ollamaResponse(JSON.stringify(answerFromSchema(JSON.parse(init.body).format)));
    }, () => withOllamaEnvironment({ EVALUATION_CONCURRENCY: limit }, () => evaluatePlanWithLlm(manySteps)));
    assert.equal(calls, 6);
    assert.equal(maxInFlight, expectedMax, `limit ${limit}`);
  }
});

test("演習と分野に応じた工程リストと固有観点を計画全体の判定へ渡す", async () => {
  const planPrompts = new Map();
  await withFetch(async (_input, init) => {
    const body = JSON.parse(init.body);
    if (body.format.properties.taskRoles) planPrompts.set(body.prompt, body.system);
    return ollamaResponse(JSON.stringify(answerFromSchema(body.format)));
  }, () => withOllamaEnvironment({}, async () => {
    for (const rubricScenarioId of ["malware", "logs", "tutorial"]) {
      await evaluatePlanWithLlm({ ...request, scenario: { ...request.scenario, title: rubricScenarioId, rubricScenarioId } });
    }
    await evaluatePlanWithLlm({
      ...request,
      scenario: {
        ...request.scenario,
        title: "custom-incident",
        rubricScenarioId: "custom",
        evaluationProfile: {
          domain: "incident-response",
          focus: { granularity: "受付票ごとに切り分ける。", context: "", safety: "", verifiability: "", artifact: "" },
          phases: [],
          incidentIds: [],
          references: [],
        },
      },
    });
  }));

  const promptFor = (title) => [...planPrompts.entries()].find(([user]) => user.includes(`"title": "${title}"`))[1];
  assert.match(promptFor("malware"), /実行しない静的観測/);
  assert.match(promptFor("malware"), /sample\.exe の配置場所/);
  assert.match(promptFor("logs"), /識別子ごとのイベントの時系列化/);
  assert.doesNotMatch(promptFor("logs"), /静的観測/);
  assert.match(promptFor("tutorial"), /バイト単位の差分比較/);
  assert.match(promptFor("custom-incident"), /証拠保全/);
  assert.match(promptFor("custom-incident"), /受付票ごとに切り分ける/);
});

test("8192未満のOllama設定と大きさの制限を超える採点要求を送信前に拒否する", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return ollamaResponse("{}");
  }, () => assert.rejects(
    withOllamaEnvironment({ OLLAMA_NUM_CTX: 4_096 }, () => evaluatePlanWithLlm(request)),
    (error) => error instanceof EvaluationServiceError
      && error.status === 503
      && /8192以上/.test(error.publicMessage),
  ));
  assert.equal(calls, 0);

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

test("コンテキスト長が大きくても推論を無効にし、responseが空ならthinkingのJSONを読む", async () => {
  const thinks = [];
  const result = await withFetch(async (_input, init) => {
    const body = JSON.parse(init.body);
    thinks.push(body.think);
    return new Response(JSON.stringify({ response: "", thinking: JSON.stringify(answerFromSchema(body.format)) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, () => withOllamaEnvironment({ OLLAMA_NUM_CTX: 32_768 }, () => evaluatePlanWithLlm(request)));
  assert.deepEqual([...new Set(thinks)], [false]);
  assert.equal(result.total, 100);
});

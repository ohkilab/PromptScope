/** Answers any evaluation call with every item met, using the grounded enums in the schema. */
export function answerFromSchema(schema) {
  // 禁止操作の検出呼び出しは、該当なし（すべてprohibited=false）で答える。
  if (schema.properties.flags) {
    const stepIds = schema.properties.flags.items.properties.stepId.enum;
    return { flags: stepIds.map((stepId) => ({ stepId, prohibited: false, sentence: "", reason: "" })) };
  }
  // 根拠の候補は軸ごとに分かれる（コンテキスト充足はコンテキスト欄だけ）。候補がない項目はmissingにする。
  // allowNotApplicableの項目はmissingのvariantが複数あり得るため、missingは複数集める。
  const items = schema.properties.results.items;
  const variants = items.anyOf ?? [items];
  const missingVariants = variants.filter((variant) => variant.properties.status.enum.includes("missing"));
  const grounded = variants.filter((variant) => !missingVariants.includes(variant));
  const allKeys = [...new Set(variants.flatMap((variant) => variant.properties.key.enum))];
  const body = {
    results: allKeys.map((key) => {
      const variant = grounded.find((candidate) => candidate.properties.key.enum.includes(key));
      const withApplicable = variant
        ? "applicable" in variant.properties
        : missingVariants.some((candidate) => candidate.properties.key.enum.includes(key) && "applicable" in candidate.properties);
      const base = variant
        ? { key, status: "met", evidence: variant.properties.evidence.enum[0], reason: "" }
        : { key, status: "missing", evidence: "", reason: "根拠がありません" };
      return withApplicable ? { ...base, applicable: true } : base;
    }),
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

export function ollamaResponse(content, extra = {}) {
  return new Response(JSON.stringify({ response: content, ...extra }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function withOllamaEnvironment(settings, callback) {
  const values = {
    LLM_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    OLLAMA_MODEL: "test-model",
    OLLAMA_NUM_CTX: "8192",
    EVALUATION_CONCURRENCY: undefined,
    LLM_REQUEST_TIMEOUT_MS: undefined,
    ...settings,
  };
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

export async function withFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** Collects console.error calls made during `callback`. */
export async function captureErrors(callback) {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const result = await callback();
    return { result, logs };
  } catch (error) {
    return { error, logs };
  } finally {
    console.error = originalError;
  }
}

/** The error Node's fetch throws when nothing listens on the port (e.g. the SSH tunnel is down). */
export function connectionRefused(port) {
  const cause = Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${port}`), { code: "ECONNREFUSED" });
  return new TypeError("fetch failed", { cause });
}

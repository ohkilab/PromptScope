import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITERION_SPECS,
  SAFETY_CHECK_IDS,
  normalizeEvaluation,
} from "../app/lib/evaluator.ts";

const defaultRequest = {
  scenario: {
    title: "ログ調査",
    description: "提供された監査ログを安全に調査する",
    goal: "安全担当者が優先度と緩和策を判断できる報告書を作る",
    environment: "読み取り専用の検証環境",
  },
  steps: [{
    id: "report",
    title: "報告書を作成する",
    instruction: "監査ログの根拠、優先度、緩和策、未確認事項をMarkdown報告書にまとめる",
    context: "読み取り専用とし、秘密情報はマスキングする",
  }],
};

function safetyChecks(missing = []) {
  return SAFETY_CHECK_IDS.map((id) => ({
    id,
    status: missing.includes(id) ? "missing" : "met",
    reason: missing.includes(id) ? `${id}の説明がない` : `${id}を確認できる`,
  }));
}

function rawEvaluation(request = defaultRequest, overrides = {}) {
  const criteriaScore = overrides.criteriaScore ?? 20;
  return {
    criteria: CRITERION_SPECS.map((criterion) => ({
      id: criterion.id,
      score: criteriaScore,
      message: `${criterion.label}の評価`,
    })),
    stepEvaluations: request.steps.map((step, index) => ({
      stepId: step.id,
      stepNumber: index + 1,
      title: step.title || `分析タスク ${index + 1}`,
      granularity: {
        score: overrides.stepScores?.[index]?.granularity ?? criteriaScore,
        message: "粒度の評価",
      },
      context: {
        score: overrides.stepScores?.[index]?.context ?? criteriaScore,
        message: "文脈の評価",
      },
    })),
    safetyAssessment: {
      checks: overrides.checks ?? safetyChecks(),
      violations: overrides.violations ?? [],
      summary: overrides.safetySummary ?? "安全境界を確認した",
    },
    artifactAssessment: {
      expectedArtifact: {
        purpose: "安全担当者の判断を支援する",
        requiredContents: ["根拠", "優先度", "緩和策", "未確認事項"],
        audience: "安全担当者",
        format: "報告書",
        destination: "",
        ...overrides.expectedArtifact,
      },
      actualArtifact: overrides.actualArtifact ?? "根拠を含むMarkdown報告書",
      defects: overrides.defects ?? [],
      summary: overrides.artifactSummary ?? "目標と成果物が整合している",
    },
    strengths: ["具体的です。"],
    improvements: [],
  };
}

function criterion(result, id) {
  return result.criteria.find((item) => item.id === id);
}

function deduction(code, points, evidence, stepId = "report", message = code) {
  return { code, points, stepIds: [stepId], evidence, message };
}

test("総合点が80点以上でも具体性の低いタスクがあれば不合格にする", () => {
  const request = {
    ...defaultRequest,
    steps: [
      { id: "good", title: "ログを確認する", instruction: "ログを確認する", context: "入力ログ" },
      { id: "empty", title: "", instruction: "", context: "" },
    ],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, {
      stepScores: [
        { granularity: 20, context: 20 },
        { granularity: 11, context: 11 },
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(result.criteria.length, 5);
  assert.equal(result.criteria[0].score, 16);
  assert.equal(result.criteria[1].score, 16);
  assert.equal(result.criteria[0].stepDetails.length, 2);
  assert.equal(result.total, 92);
  assert.equal(result.passed, false);
  assert.deepEqual(result.gateFailures, [
    "タスク2の分割粒度は12点以上が必要です。",
    "タスク2のコンテキスト充足は12点以上が必要です。",
  ]);
});

test("総合点と全タスクの最低点を満たした場合だけ合格にする", () => {
  const result = normalizeEvaluation(
    rawEvaluation(defaultRequest, {
      criteriaScore: 16,
      checks: safetyChecks(["authorized_scope", "stop_and_recovery"]),
      defects: [
        deduction("missing_required_content", 2, "緩和策"),
        deduction("missing_required_content", 2, "未確認事項"),
      ],
    }),
    defaultRequest,
    "openrouter",
    "test-model",
  );

  assert.equal(result.total, 80);
  assert.equal(result.passed, true);
  assert.deepEqual(result.gateFailures, []);
});

test("安全要件の不足数を1件につき2点として再計算する", () => {
  for (const [missingCount, expectedScore] of [[0, 20], [1, 18], [2, 16], [3, 14]]) {
    const result = normalizeEvaluation(
      rawEvaluation(defaultRequest, {
        checks: safetyChecks(SAFETY_CHECK_IDS.slice(0, missingCount)),
      }),
      defaultRequest,
      "ollama",
      "test-model",
    );
    assert.equal(criterion(result, "safety").score, expectedScore);
  }
});

test("明示的な安全違反を固定減点し、同じ違反コードを重複加算しない", () => {
  const request = {
    ...defaultRequest,
    steps: [
      { ...defaultRequest.steps[0], instruction: "管理者権限で監査ログを読む" },
      { id: "again", title: "再確認", instruction: "sudoを使って再確認する", context: "監査ログ" },
    ],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, {
      checks: safetyChecks(["least_privilege"]),
      violations: [
        deduction("privilege_escalation", 6, "管理者権限で監査ログを読む"),
        deduction("privilege_escalation", 6, "sudoを使って再確認する", "again"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 14);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /明示的な安全違反/);
});

test("秘密情報の読み取りと無保護出力は別の違反として加算する", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "SSH秘密鍵の内容を読み取り、マスキングせず報告書へ保存する",
    }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, {
      violations: [
        deduction("secret_content_access", 8, "SSH秘密鍵の内容を読み取り"),
        deduction("secret_unprotected_output", 10, "マスキングせず報告書へ保存する"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 2);
  assert.equal(result.passed, false);
});

test("成果物の必須内容不足を1件2点、最大6点として再計算する", () => {
  const evidence = ["根拠", "優先度", "緩和策"];
  for (const [count, expectedScore] of [[1, 18], [2, 16], [3, 14], [4, 14]]) {
    const defects = Array.from({ length: count }, (_, index) =>
      deduction("missing_required_content", 2, evidence[index % evidence.length], "report", `不足${index}`));
    const result = normalizeEvaluation(
      rawEvaluation(defaultRequest, { defects }),
      defaultRequest,
      "ollama",
      "test-model",
    );
    assert.equal(criterion(result, "artifact").score, expectedScore);
  }
});

test("計画に明記済みの読者・形式・引き渡し先を不足として減点しない", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: `${defaultRequest.steps[0].instruction}。安全担当者へ渡す`,
    }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, {
      expectedArtifact: { destination: "安全担当者" },
      defects: [
        deduction("missing_audience", 1, "安全担当者"),
        deduction("missing_format", 1, "Markdown報告書"),
        deduction("missing_destination", 1, "安全担当者"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "artifact").score, 20);
});

test("最終成果物なしは10点減点し、付随する欠落を重複加算しない", () => {
  const result = normalizeEvaluation(
    rawEvaluation(defaultRequest, {
      actualArtifact: "最終成果物の指定なし",
      defects: [
        deduction("no_final_artifact", 10, "監査ログ"),
        deduction("missing_required_content", 2, "緩和策"),
        deduction("missing_audience", 1, "安全担当者"),
        deduction("missing_format", 1, "報告書"),
        deduction("missing_destination", 1, "報告書"),
      ],
    }),
    defaultRequest,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "artifact").score, 10);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /最終成果物が指定されていない/);
});

test("目標と成果物の不一致は10点減点し、重大問題として不合格にする", () => {
  const result = normalizeEvaluation(
    rawEvaluation(defaultRequest, {
      actualArtifact: "作業時刻だけのCSV日誌",
      defects: [deduction("goal_mismatch", 10, "安全担当者が優先度と緩和策を判断できる報告書")],
    }),
    defaultRequest,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "artifact").score, 10);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /演習目的と一致しない/);
});

test("成果物の明確さは11点で不合格、12点で合格可能にする", () => {
  const request = {
    ...defaultRequest,
    steps: [
      defaultRequest.steps[0],
      { id: "review", title: "報告書を確認する", instruction: "Markdown報告書を確認する", context: "監査ログ" },
    ],
  };
  const commonDefects = [
    deduction("missing_evidence_traceability", 3, "監査ログ"),
    deduction("missing_handoff", 2, "報告書"),
    deduction("missing_acceptance_condition", 2, "Markdown報告書"),
    deduction("missing_audience", 1, "安全担当者"),
  ];
  const score12 = normalizeEvaluation(
    rawEvaluation(request, { defects: commonDefects }),
    request,
    "ollama",
    "test-model",
  );
  const score11 = normalizeEvaluation(
    rawEvaluation(request, {
      expectedArtifact: { destination: "監査チーム共有庫" },
      defects: [...commonDefects, deduction("missing_destination", 1, "Markdown報告書")],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(score12, "artifact").score, 12);
  assert.equal(score12.passed, true);
  assert.equal(criterion(score11, "artifact").score, 11);
  assert.equal(score11.passed, false);
  assert.match(score11.gateFailures.join(" "), /12点以上/);
});

test("入力に存在しない根拠引用を拒否する", () => {
  assert.throws(
    () => normalizeEvaluation(
      rawEvaluation(defaultRequest, {
        violations: [deduction("privilege_escalation", 6, "入力には存在しない管理者権限の指示")],
      }),
      defaultRequest,
      "ollama",
      "test-model",
    ),
    /evidence not found/,
  );
});

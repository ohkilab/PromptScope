import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITERION_SPECS,
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

function rawEvaluation(request = defaultRequest, overrides = {}) {
  const criteriaScore = overrides.criteriaScore ?? 20;
  return {
    criteria: CRITERION_SPECS
      .filter((criterion) => ["granularity", "context", "verifiability"].includes(criterion.id))
      .map((criterion) => ({
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
      obviousTypos: overrides.obviousTypos?.[index] ?? [],
    })),
    safetyAssessment: {
      violations: overrides.violations ?? [],
    },
    artifactAssessment: {
      expectedArtifact: {
        purpose: "安全担当者の判断を支援する",
        requiredContents: ["根拠", "優先度", "緩和策", "未確認事項"],
        ...overrides.expectedArtifact,
      },
      actualArtifact: overrides.actualArtifact ?? "根拠を含むMarkdown報告書",
      defects: overrides.defects ?? [],
    },
    strengths: ["具体的です。"],
    improvements: [],
  };
}

function criterion(result, id) {
  return result.criteria.find((item) => item.id === id);
}

function deduction(code, evidence, stepId = "report", missingItem = "") {
  return { code, stepIds: [stepId], evidence, missingItem };
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
  assert.equal(result.criteria[0].score, 13);
  assert.equal(result.criteria[1].score, 13);
  assert.equal(result.criteria[0].stepDetails.length, 2);
  assert.equal(result.total, 86);
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
      defects: [
        deduction("missing_required_content", "緩和策", "report", "緩和策"),
        deduction("missing_required_content", "優先度", "report", "優先度"),
      ],
    }),
    defaultRequest,
    "openrouter",
    "test-model",
  );

  assert.equal(result.total, 84);
  assert.equal(result.passed, true);
  assert.deepEqual(result.gateFailures, []);
});

test("明白な無意味入力はLLMの高得点を採用せず5点以下にする", () => {
  const request = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "aaaaa", context: "TODO" }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "granularity").score, 5);
  assert.equal(criterion(result, "context").score, 5);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /タスク1の分割粒度/);
  assert.match(result.gateFailures.join(" "), /タスク1のコンテキスト充足/);
});

test("明白な誤字を含む提示入力は総合点が高くても不合格にする", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "静的・動的観測を、事実・解釈・未確認事項・推奨する安全な追加確認に分けた短い報告書にまとめてください。aaaaaa，スナップショットから復元できるテスト VM で、プロセス・ファイル・レジストリ相当の変化を観測する手順を作ってください。外部通信は発生させないでください。あああああ",
    }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, {
      obviousTypos: [[
        { field: "instruction", evidence: "aaaaaa", reason: "意味のない文字反復" },
        { field: "instruction", evidence: "あああああ", reason: "意味のない文字反復" },
      ]],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "granularity").score, 11);
  assert.equal(result.total, 91);
  assert.equal(result.passed, false);
  assert.match(
    criterion(result, "granularity").stepDetails[0].message,
    /明白な誤字2件.*固定減点4点後、11点を上限/,
  );
  assert.match(result.gateFailures.join(" "), /タスク1の分割粒度/);
});

test("入力に存在しない明白な誤字の根拠を拒否する", () => {
  assert.throws(
    () => normalizeEvaluation(
      rawEvaluation(defaultRequest, {
        obviousTypos: [[{
          field: "instruction",
          evidence: "入力に存在しない誤字",
          reason: "意味のない文字列",
        }]],
      }),
      defaultRequest,
      "ollama",
      "test-model",
    ),
    /obvious typo evidence not found/,
  );
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
      violations: [
        deduction("privilege_escalation", "管理者権限で監査ログを読む"),
        deduction("privilege_escalation", "sudoを使って再確認する", "again"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 14);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /安全性・権限境界/);
});

test("LLMが見逃しても明示的な管理者権限の使用を固定減点する", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "スナップショットから復元できるテスト VM で、管理者権限を用いて変化を観測する",
    }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, { violations: [] }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 14);
  assert.equal(result.passed, false);
});

test("管理者権限を使用しないという否定文は決定論ルールで減点しない", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "管理者権限を使用しない読み取り専用の手順を作る",
    }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, { violations: [] }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 20);
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
        deduction("secret_content_access", "SSH秘密鍵の内容を読み取り"),
        deduction("secret_unprotected_output", "マスキングせず報告書へ保存する"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 2);
  assert.equal(result.passed, false);
});

test("保護・禁止を指示する文はSafety違反として返されても減点しない", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "機密情報はマスキングし、外部通信は発生させない",
    }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, {
      violations: [
        deduction("secret_unprotected_output", "機密情報はマスキングし"),
        deduction("unauthorized_target_access", "外部通信は発生させない"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 20);
});

test("保護指示と無保護出力が混在する場合はSafety違反を維持する", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "識別子はマスキングし、APIキーは平文で保存する",
    }],
  };
  const result = normalizeEvaluation(
    rawEvaluation(request, {
      violations: [
        deduction("secret_unprotected_output", "識別子はマスキングし、APIキーは平文で保存する"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "safety").score, 10);
});

test("成果物の必須内容不足を1件2点、最大6点として再計算する", () => {
  const request = {
    ...defaultRequest,
    scenario: {
      ...defaultRequest.scenario,
      goal: "安全担当者が根拠、優先度、緩和策を判断できる報告書を作る",
    },
  };
  const evidence = ["根拠", "優先度", "緩和策"];
  for (const [count, expectedScore] of [[1, 18], [2, 16], [3, 14], [4, 14]]) {
    const defects = Array.from({ length: count }, (_, index) =>
      deduction(
        "missing_required_content",
        evidence[index % evidence.length],
        "report",
        evidence[index % evidence.length],
      ));
    const result = normalizeEvaluation(
      rawEvaluation(request, { actualArtifact: "Markdown報告書", defects }),
      request,
      "ollama",
      "test-model",
    );
    assert.equal(criterion(result, "artifact").score, expectedScore);
  }
});

test("同じ必須内容不足を複数回返されても1回だけ減点する", () => {
  const result = normalizeEvaluation(
    rawEvaluation(defaultRequest, {
      defects: [
        deduction("missing_required_content", "緩和策", "report", "緩和策"),
        deduction(
          "missing_required_content",
          "緩和策",
          "report",
          "緩和策（優先順位を含む）",
        ),
      ],
    }),
    defaultRequest,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "artifact").score, 18);
});

test("goalにない項目やactualArtifactにある項目を必須内容不足として減点しない", () => {
  const result = normalizeEvaluation(
    rawEvaluation(defaultRequest, {
      actualArtifact: "根拠と優先度を含むMarkdown報告書",
      defects: [
        deduction("missing_required_content", "緩和策", "report", "静的解析結果"),
        deduction("missing_required_content", "優先度", "report", "優先度"),
      ],
    }),
    defaultRequest,
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
        deduction("no_final_artifact", "監査ログ"),
        deduction("goal_mismatch", "安全担当者が優先度と緩和策を判断できる報告書"),
        deduction("missing_required_content", "緩和策", "report", "緩和策"),
        deduction("missing_acceptance_condition", "Markdown報告書"),
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

test("必須内容不足の識別名が空なら採点結果を拒否する", () => {
  assert.throws(
    () => normalizeEvaluation(
      rawEvaluation(defaultRequest, {
        defects: [deduction("missing_required_content", "緩和策")],
      }),
      defaultRequest,
      "ollama",
      "test-model",
    ),
    /missing artifact defect missingItem/,
  );
});

test("目標と成果物の不一致は10点減点し、重大問題として不合格にする", () => {
  const result = normalizeEvaluation(
    rawEvaluation(defaultRequest, {
      actualArtifact: "作業時刻だけのCSV日誌",
      defects: [deduction("goal_mismatch", "安全担当者が優先度と緩和策を判断できる報告書")],
    }),
    defaultRequest,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(result, "artifact").score, 10);
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /演習目的と一致しない/);
});

test("成果物の明確さは11点で不合格、13点で合格可能にする", () => {
  const request = {
    ...defaultRequest,
    steps: [
      defaultRequest.steps[0],
      { id: "review", title: "報告書を確認する", instruction: "Markdown報告書を確認する", context: "監査ログ" },
    ],
  };
  const commonDefects = [
    deduction("missing_evidence_traceability", "監査ログ"),
    deduction("missing_handoff", "報告書"),
    deduction("missing_acceptance_condition", "Markdown報告書"),
  ];
  const score13 = normalizeEvaluation(
    rawEvaluation(request, { defects: commonDefects }),
    request,
    "ollama",
    "test-model",
  );
  const score11 = normalizeEvaluation(
    rawEvaluation(request, {
      defects: [
        ...commonDefects,
        deduction("missing_required_content", "優先度", "report", "優先度"),
      ],
    }),
    request,
    "ollama",
    "test-model",
  );

  assert.equal(criterion(score13, "artifact").score, 13);
  assert.equal(score13.passed, true);
  assert.equal(criterion(score11, "artifact").score, 11);
  assert.equal(score11.passed, false);
  assert.match(score11.gateFailures.join(" "), /12点以上/);
});

test("入力に存在しない根拠引用を拒否する", () => {
  assert.throws(
    () => normalizeEvaluation(
      rawEvaluation(defaultRequest, {
        violations: [deduction("privilege_escalation", "入力には存在しない管理者権限の指示")],
      }),
      defaultRequest,
      "ollama",
      "test-model",
    ),
    /evidence not found/,
  );
});

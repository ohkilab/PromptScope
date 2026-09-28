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
    safetyAssessment: { violations: overrides.violations ?? [] },
    artifactAssessment: {
      expectedArtifact: {
        purpose: "安全担当者の判断を支援する",
        requiredContents: ["根拠", "優先度", "緩和策", "未確認事項"],
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

function evaluate(request = defaultRequest, overrides = {}) {
  return normalizeEvaluation(rawEvaluation(request, overrides), request, "ollama", "test-model");
}

test("合格条件と無意味な入力の上限を適用する", () => {
  const passing = evaluate(defaultRequest, {
    criteriaScore: 16,
    defects: [
      deduction("missing_required_content", "緩和策", "report", "緩和策"),
      deduction("missing_required_content", "優先度", "report", "優先度"),
    ],
  });
  assert.equal(passing.total, 84);
  assert.equal(passing.passed, true);

  const lowStepRequest = {
    ...defaultRequest,
    steps: [
      { id: "good", title: "ログを確認する", instruction: "ログを確認する", context: "入力ログ" },
      { id: "empty", title: "", instruction: "", context: "" },
    ],
  };
  const lowStep = evaluate(lowStepRequest, {
    stepScores: [
      { granularity: 20, context: 20 },
      { granularity: 11, context: 11 },
    ],
  });
  assert.equal(lowStep.total, 86);
  assert.equal(lowStep.passed, false);
  assert.match(lowStep.gateFailures.join(" "), /タスク2の分割粒度/);
  assert.match(lowStep.gateFailures.join(" "), /タスク2のコンテキスト充足/);

  const meaninglessRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "aaaaa", context: "TODO" }],
  };
  const meaningless = evaluate(meaninglessRequest);
  assert.equal(criterion(meaningless, "granularity").score, 5);
  assert.equal(criterion(meaningless, "context").score, 5);
  assert.equal(meaningless.passed, false);
});

test("明白な誤字を減点し，不正な根拠を拒否する", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "報告書にまとめる。aaaaaa，隔離VMで変化を観測する。あああああ",
    }],
  };
  const result = evaluate(request, {
    obviousTypos: [[
      { field: "instruction", evidence: "aaaaaa", reason: "意味のない文字反復" },
      { field: "instruction", evidence: "あああああ", reason: "意味のない文字反復" },
    ]],
  });
  assert.equal(criterion(result, "granularity").score, 11);
  assert.equal(result.total, 91);
  assert.equal(result.passed, false);
  assert.match(criterion(result, "granularity").stepDetails[0].message, /明白な誤字2件/);

  assert.throws(
    () => evaluate(defaultRequest, {
      obviousTypos: [[{
        field: "instruction",
        evidence: "入力に存在しない誤字",
        reason: "意味のない文字列",
      }]],
    }),
    /obvious typo evidence not found/,
  );
});

test("Safetyの固定減点，重複除去，否定文除外を適用する", () => {
  const duplicateRequest = {
    ...defaultRequest,
    steps: [
      { ...defaultRequest.steps[0], instruction: "管理者権限で監査ログを読む" },
      { id: "again", title: "再確認", instruction: "sudoを使って再確認する", context: "監査ログ" },
    ],
  };
  const duplicate = evaluate(duplicateRequest, {
    violations: [
      deduction("privilege_escalation", "管理者権限で監査ログを読む"),
      deduction("privilege_escalation", "sudoを使って再確認する", "again"),
    ],
  });
  assert.equal(criterion(duplicate, "safety").score, 14);
  assert.equal(duplicate.passed, false);

  const detectedRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "管理者権限を用いて変化を観測する" }],
  };
  assert.equal(criterion(evaluate(detectedRequest), "safety").score, 14);

  const negativeRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "管理者権限を使用しない手順を作る" }],
  };
  assert.equal(criterion(evaluate(negativeRequest), "safety").score, 20);

  const secretRequest = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "SSH秘密鍵の内容を読み取り、マスキングせず報告書へ保存する",
    }],
  };
  const secrets = evaluate(secretRequest, {
    violations: [
      deduction("secret_content_access", "SSH秘密鍵の内容を読み取り"),
      deduction("secret_unprotected_output", "マスキングせず報告書へ保存する"),
    ],
  });
  assert.equal(criterion(secrets, "safety").score, 2);

  const safeRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "機密情報はマスキングし、外部通信は発生させない" }],
  };
  const safe = evaluate(safeRequest, {
    violations: [
      deduction("secret_unprotected_output", "機密情報はマスキングし"),
      deduction("unauthorized_target_access", "外部通信は発生させない"),
    ],
  });
  assert.equal(criterion(safe, "safety").score, 20);

  const mixedRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "識別子はマスキングし、APIキーは平文で保存する" }],
  };
  const mixed = evaluate(mixedRequest, {
    violations: [
      deduction("secret_unprotected_output", "識別子はマスキングし、APIキーは平文で保存する"),
    ],
  });
  assert.equal(criterion(mixed, "safety").score, 10);
});

test("Artifactの固定減点，重複除去，合格下限を適用する", () => {
  const request = {
    ...defaultRequest,
    scenario: {
      ...defaultRequest.scenario,
      goal: "安全担当者が根拠、優先度、緩和策を判断できる報告書を作る",
    },
  };
  const required = ["根拠", "優先度", "緩和策"];
  for (const [count, expectedScore] of [[1, 18], [2, 16], [3, 14], [4, 14]]) {
    const defects = Array.from({ length: count }, (_, index) =>
      deduction(
        "missing_required_content",
        required[index % required.length],
        "report",
        required[index % required.length],
      ));
    assert.equal(
      criterion(evaluate(request, { actualArtifact: "Markdown報告書", defects }), "artifact").score,
      expectedScore,
    );
  }

  const duplicate = evaluate(defaultRequest, {
    defects: [
      deduction("missing_required_content", "緩和策", "report", "緩和策"),
      deduction("missing_required_content", "緩和策", "report", "緩和策（優先順位を含む）"),
    ],
  });
  assert.equal(criterion(duplicate, "artifact").score, 18);

  const ignored = evaluate(defaultRequest, {
    actualArtifact: "根拠と優先度を含むMarkdown報告書",
    defects: [
      deduction("missing_required_content", "緩和策", "report", "静的解析結果"),
      deduction("missing_required_content", "優先度", "report", "優先度"),
    ],
  });
  assert.equal(criterion(ignored, "artifact").score, 20);

  const noArtifact = evaluate(defaultRequest, {
    actualArtifact: "最終成果物の指定なし",
    defects: [
      deduction("no_final_artifact", "監査ログ"),
      deduction("goal_mismatch", "安全担当者が優先度と緩和策を判断できる報告書"),
      deduction("missing_required_content", "緩和策", "report", "緩和策"),
      deduction("missing_acceptance_condition", "Markdown報告書"),
    ],
  });
  assert.equal(criterion(noArtifact, "artifact").score, 10);
  assert.match(noArtifact.gateFailures.join(" "), /最終成果物が指定されていない/);

  const mismatch = evaluate(defaultRequest, {
    actualArtifact: "作業時刻だけのCSV日誌",
    defects: [deduction("goal_mismatch", "安全担当者が優先度と緩和策を判断できる報告書")],
  });
  assert.equal(criterion(mismatch, "artifact").score, 10);
  assert.match(mismatch.gateFailures.join(" "), /演習目的と一致しない/);

  const thresholdRequest = {
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
  const score13 = evaluate(thresholdRequest, { defects: commonDefects });
  const score11 = evaluate(thresholdRequest, {
    defects: [
      ...commonDefects,
      deduction("missing_required_content", "優先度", "report", "優先度"),
    ],
  });
  assert.equal(criterion(score13, "artifact").score, 13);
  assert.equal(score13.passed, true);
  assert.equal(criterion(score11, "artifact").score, 11);
  assert.equal(score11.passed, false);
});

test("LLMが返した根拠と必須内容を検証する", () => {
  assert.throws(
    () => evaluate(defaultRequest, {
      violations: [deduction("privilege_escalation", "入力には存在しない管理者権限の指示")],
    }),
    /evidence not found/,
  );
  assert.throws(
    () => evaluate(defaultRequest, {
      defects: [deduction("missing_required_content", "緩和策")],
    }),
    /missing artifact defect missingItem/,
  );
});

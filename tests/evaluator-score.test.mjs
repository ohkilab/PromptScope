import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeEvaluation,
} from "../app/lib/evaluator.ts";

const defaultRequest = {
  scenario: {
    title: "ログ調査",
    description: "提供された監査ログを安全に調査する",
    goal: "安全担当者が優先度と緩和策を判断できる報告書を作る",
    environment: "隔離された検証環境で，読み取り専用の一般ユーザー権限だけを使用し，管理者権限と権限昇格は禁止する．対象はローカル監査ログだけとし，外部通信は禁止する．異常を検知した場合は作業を中止し，スナップショットから復元する．",
  },
  steps: [{
    id: "report",
    title: "報告書を作成する",
    instruction: "監査ログの根拠、優先度、緩和策、未確認事項、成功条件をMarkdown報告書にまとめ、同じ証跡で再確認し、証跡不足時は判断を保留する",
    context: "監査ログを入力とし、読み取り専用で確認する．秘密情報はマスキングし，保存は検証環境内だけに限定して外部へ共有・送信しない",
  }],
};

const perfectMalwareRequest = {
  scenario: {
    title: "sample.exeの安全な解析計画",
    description: "架空の検体について，保全，静的確認，動的観測の結果を安全に統合する",
    goal: "外部に影響を与えず，観測事実，解釈，未確認事項，推奨する安全な追加確認を分けた解析計画を作る",
    environment: "ネットワーク遮断済みの使い捨て仮想マシンを使用する．読み取り専用の一般ユーザー権限だけを許可し，管理者権限，root，sudo，権限昇格は禁止する．操作対象は隔離ラボの架空のsample.exeだけとし，外部ホストへの接続は禁止する．機密情報はマスキングし，記録は隔離ラボ内だけに保存して外部へ共有・送信しない．外部接続の試行，想定外の書き込み，権限要求を異常として検知した場合は直ちに作業を中止し，仮想マシンを停止して取得済みスナップショットから復元する",
  },
  steps: [
    {
      id: "perfect-preserve",
      title: "解析用コピーを保全する",
      instruction: "原本を変更せずにsample.exeの解析用コピーを作り，原本とコピーのSHA-256，ファイルサイズ，取得時刻，作業者を保全記録へ記載する．成功条件は両方のSHA-256が一致することとし，不一致なら作業を中止して理由を未確認事項として記録する",
      context: "入力は隔離ラボの/lab/inbox/sample.exeである．読み取り専用の一般ユーザー権限だけを使い，管理者権限と権限昇格は禁止する．機密情報はマスキングし，保全記録は隔離ラボ内だけに保存して外部へ共有・送信しない．このタスクは最初のタスクなので前段結果は不要である",
    },
    {
      id: "perfect-static",
      title: "静的観測を記録する",
      instruction: "解析用コピーを実行せず，形式，署名，ハッシュ，文字列，依存関係を観測し，各結果を証跡ID付きの静的観測記録へ事実として記載する．成功条件は全観測項目に証跡IDと取得方法があることとし，判断材料が足りない項目は判断を保留して追加確認事項にする",
      context: "入力はタスク1の解析用コピー，保全記録，原本とコピーのSHA-256である．両方のSHA-256が一致した場合だけ進める．ネットワーク遮断済み仮想マシンと読み取り専用の一般ユーザー権限を使い，検体は実行しない．静的観測記録は隔離ラボ内だけに保存する",
    },
    {
      id: "perfect-dynamic",
      title: "動的観測を記録する",
      instruction: "スナップショットから復元したテスト仮想マシンで解析用コピーを1回だけ実行し，実行前後のプロセス，ファイル，レジストリ相当，遮断済み通信ログの差分を証跡ID付きの動的観測記録へ事実として記載する．成功条件は実行前後の記録と差分がそろうこととし，欠落があれば判断を保留して追加確認事項にする",
      context: "入力はタスク1の解析用コピーと保全記録，タスク2の静的観測記録である．外部通信は禁止し，無害なダミーデータだけを使う．外部接続の試行，想定外の書き込み，権限要求を検知した場合は直ちに作業を中止し，仮想マシンを停止してスナップショットから復元する．記録は隔離ラボ内だけに保存する",
    },
    {
      id: "perfect-report",
      title: "解析計画を作成する",
      instruction: "保全記録，静的観測記録，動的観測記録を統合し，観測事実，証跡に基づく解釈，未確認事項，推奨する安全な追加確認，成功・失敗条件を分けたMarkdown解析計画を作成する．各記述に証跡IDを付け，第三者が同じ入力ハッシュ，ツール版，手順，スナップショットで再確認できるようにする．証跡が不足する結論は判断を保留し，必要な追加証跡を明記する",
      context: "入力はタスク1の保全記録，タスク2の静的観測記録，タスク3の動的観測記録である．最終成果物は隔離ラボ内のanalysis-plan.mdとし，機密情報をマスキングして外部へ共有・送信しない．観測事実と解釈を混同せず，確認できない意図や悪性を断定しない",
    },
  ],
};

function rawEvaluation(request = defaultRequest, overrides = {}) {
  const baseSubscore = overrides.subscore ?? 5;
  const scored = (score, message) => ({ score: score ?? baseSubscore, message });
  const safetyControl = (id, defaultEvidence) => {
    const status = overrides.safetyControls?.[id]?.status ?? "satisfied";
    return {
      status,
      evidence: status === "missing"
        ? ""
        : overrides.safetyControls?.[id]?.evidence ?? defaultEvidence,
      reason: overrides.safetyControls?.[id]?.reason ?? `${id}の安全対策を確認した`,
    };
  };
  return {
    planEvaluation: {
      granularity: {
        taskCoverage: scored(overrides.planScores?.taskCoverage, "必要な工程を確認した"),
        order: scored(overrides.planScores?.order, "依存関係を確認した"),
      },
      verifiability: {
        decisionCriteria: scored(overrides.planScores?.decisionCriteria, "判定条件を確認した"),
        evidence: scored(overrides.planScores?.evidence, "判定根拠を確認した"),
        reproducibility: scored(overrides.planScores?.reproducibility, "再確認方法を確認した"),
        uncertaintyHandling: scored(overrides.planScores?.uncertaintyHandling, "判断保留を確認した"),
      },
    },
    stepEvaluations: request.steps.map((step, index) => ({
      stepId: step.id,
      stepNumber: index + 1,
      title: step.title || `分析タスク ${index + 1}`,
      granularity: {
        singlePurpose: scored(overrides.stepSubscores?.[index]?.singlePurpose, "主要作業を確認した"),
        size: scored(overrides.stepSubscores?.[index]?.size, "委任可能な大きさを確認した"),
      },
      context: {
        target: scored(overrides.stepSubscores?.[index]?.target, "対象を確認した"),
        inputMaterial: scored(overrides.stepSubscores?.[index]?.inputMaterial, "入力資料を確認した"),
        constraints: scored(overrides.stepSubscores?.[index]?.constraints, "前提と制約を確認した"),
        priorResult: scored(overrides.stepSubscores?.[index]?.priorResult, "前段の結果を確認した"),
      },
      obviousTypos: overrides.obviousTypos?.[index] ?? [],
    })),
    safetyAssessment: {
      controls: {
        permission: safetyControl("permission", request.scenario.environment),
        secrets: safetyControl("secrets", request.steps[0]?.context ?? request.scenario.environment),
        scope: safetyControl("scope", request.scenario.environment),
        environmentImpact: safetyControl("environmentImpact", request.scenario.environment),
      },
      violations: overrides.violations ?? [],
    },
    artifactAssessment: {
      expectedArtifact: {
        purpose: "安全担当者の判断を支援する",
        requiredContents: ["根拠", "優先度", "緩和策", "未確認事項"],
      },
      actualArtifact: overrides.actualArtifact ?? "根拠を含むMarkdown報告書",
      defects: overrides.defects ?? [],
    },
    strengths: ["具体的です。"],
    improvements: overrides.improvements ?? [],
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

test("100点の計画，合格条件，無意味な入力の上限を確認する", () => {
  const perfect = evaluate(perfectMalwareRequest, {
    actualArtifact: "観測事実，解釈，未確認事項，推奨する安全な追加確認，成功・失敗条件，証跡IDを含むMarkdown解析計画",
  });
  assert.equal(perfect.total, 100);
  assert.equal(perfect.passed, true);
  assert.deepEqual(perfect.gateFailures, []);

  const passing = evaluate(defaultRequest, {
    subscore: 4,
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
  });
  assert.equal(lowStep.total, 45);
  assert.equal(lowStep.passed, false);
  assert.match(lowStep.gateFailures.join(" "), /タスク2の分割粒度/);
  assert.match(lowStep.gateFailures.join(" "), /タスク2のコンテキスト充足/);

  const meaninglessRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "aaaaa", context: "TODO" }],
  };
  const meaningless = evaluate(meaninglessRequest);
  assert.equal(criterion(meaningless, "granularity").score, 7);
  assert.equal(criterion(meaningless, "context").score, 0);
  assert.equal(meaningless.passed, false);
});

test("明白な誤字を減点し，不正な根拠を拒否する", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "根拠、優先度、緩和策、成功条件を報告書にまとめ、同じ証跡で再確認し、証跡不足時は判断を保留する。aaaaaa，隔離VMで変化を観測する。あああああ",
    }],
  };
  const result = evaluate(request, {
    obviousTypos: [[
      { field: "instruction", evidence: "aaaaaa", reason: "意味のない文字反復" },
      { field: "instruction", evidence: "あああああ", reason: "意味のない文字反復" },
    ]],
  });
  assert.equal(criterion(result, "granularity").score, 15);
  assert.equal(result.total, 95);
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

test("Safetyの加点と減点，重複除去，否定文除外を適用する", () => {
  const missingControls = evaluate(defaultRequest, {
    safetyControls: Object.fromEntries(
      ["permission", "secrets", "scope", "environmentImpact"].map((id) => [id, { status: "missing" }]),
    ),
  });
  assert.equal(criterion(missingControls, "safety").score, 0);

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
  assert.equal(criterion(duplicate, "safety").score, 15);
  assert.equal(duplicate.passed, false);

  const detectedRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "管理者権限を用いて変化を観測する" }],
  };
  assert.equal(criterion(evaluate(detectedRequest), "safety").score, 15);

  const negativeRequest = {
    ...defaultRequest,
    steps: [{ ...defaultRequest.steps[0], instruction: "管理者権限を使用しない手順を作る" }],
  };
  assert.equal(criterion(evaluate(negativeRequest), "safety").score, 20);

  const preservationContext = "検体は隔離ラボの /lab/inbox に置かれています。コピーを解析用領域に作り、原本のハッシュと作業者・操作時刻を記録します。ハッシュだけで悪性とは断定せず、確認できた事実として扱ってください。機密情報はマスキングし，保存は検証環境内に限定して外部へ共有・送信しません。";
  const unsupportedPrivilegeRequest = {
    ...defaultRequest,
    steps: [{
      id: "preserve",
      title: "検体と証拠を保全する",
      instruction: "検体を読み取り専用で保全してください。",
      context: preservationContext,
    }],
  };
  const unsupportedPrivilege = evaluate(unsupportedPrivilegeRequest, {
    violations: [deduction("privilege_escalation", preservationContext, "preserve")],
  });
  assert.equal(criterion(unsupportedPrivilege, "safety").score, 20);
  assert.equal(criterion(unsupportedPrivilege, "safety").findings, undefined);

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
  assert.equal(criterion(secrets, "safety").score, 15);
  assert.deepEqual(
    criterion(secrets, "safety").findings.map((finding) => finding.points),
    [5],
  );
  assert.equal(criterion(secrets, "safety").findings[0].stepReferences[0], "タスク1「報告書を作成する」");
  assert.match(criterion(secrets, "safety").findings[0].evidence, /SSH秘密鍵/);
  assert.match(secrets.improvements.join(" "), /安全性: 秘密情報の読み取り（タスク1）/);

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
  assert.equal(criterion(mixed, "safety").score, 15);
});

test("検体解析の3タスク計画は安全な否定文を減点せず，成果物不足で不合格にする", () => {
  const request = {
    scenario: {
      title: "sample.exe の安全な解析方針",
      description: "架空の検体を隔離したラボで調べ、静的情報と動作観測を結び付けます。",
      goal: "外部に影響を与えず、観測事実・推測・次の確認事項を分けた解析計画を作る。",
      environment: "ネットワーク遮断済みの使い捨て仮想マシン。検体は架空の sample.exe、権限は最小限、スナップショットを取得済み。",
    },
    steps: [
      {
        id: "malware-preserve",
        title: "検体と証拠を保全する",
        instruction: "sample.exe の情報を読み取り専用で記録してください。",
        context: "検体は /lab/inbox に置かれています。コピーを解析用領域に作り記録します。機密情報はマスクしてください．",
      },
      {
        id: "malware-static",
        title: "静的解析の観点を整理する",
        instruction: "実行せずに確認できる情報を列挙し、各観測から言える範囲を明記してください。",
        context: "解析端末は外部通信を遮断し、管理者権限を使えません。機密情報はマスクしてください．",
      },
      {
        id: "malware-dynamic",
        title: "動的観測を最小リスクで設計する",
        instruction: "スナップショットから復元できるテスト VM で、プロセス・ファイル・レジストリ相当の変化を観測する手順を作ってください．",
        context: "動的解析は無害なダミーデータだけを使い、通信は遮断されたモック層で記録します。機密情報はマスクしてください．",
      },
    ],
  };
  const result = evaluate(request, {
    safetyControls: {
      permission: { status: "satisfied", evidence: request.scenario.environment },
      secrets: { status: "satisfied", evidence: request.steps[0].context },
      scope: { status: "satisfied", evidence: request.scenario.environment },
      environmentImpact: { status: "satisfied", evidence: request.scenario.environment },
    },
    violations: [
      deduction(
        "privilege_escalation",
        "解析端末は外部通信を遮断し、管理者権限を使えません。機密情報はマスクしてください．",
        "malware-static",
      ),
      deduction(
        "unauthorized_target_access",
        "解析端末は外部通信を遮断し、管理者権限を使えません。機密情報はマスクしてください．",
        "malware-static",
      ),
      deduction(
        "secret_unprotected_output",
        "機密情報はマスクしてください．",
        "malware-preserve",
      ),
    ],
    actualArtifact: "個別の保全手順、静的解析項目、動的観測手順",
    defects: [],
  });

  assert.equal(criterion(result, "safety").score, 14);
  assert.equal(criterion(result, "granularity").score, 17);
  assert.equal(criterion(result, "context").score, 15);
  assert.equal(criterion(result, "verifiability").score, 5);
  assert.equal(criterion(result, "artifact").score, 0);
  assert.equal(result.total, 51);
  assert.deepEqual(
    result.criteria.map((item) => item.subcriteria.map((subcriterion) => subcriterion.label)),
    [
      ["単一性", "大きさ", "タスク数", "順序"],
      ["対象", "入力資料", "前提・制約", "前段の結果"],
      ["権限", "機密情報", "対象範囲", "環境への影響"],
      ["判定条件", "判定の根拠", "再確認", "判断保留"],
      ["目的との整合", "必要な内容", "結果の引き継ぎ"],
    ],
  );
  assert.equal(result.passed, false);
  assert.match(result.gateFailures.join(" "), /最終成果物が指定されていない/);
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
      deduction("missing_required_content", "緩和策", "report", "緩和策"),
    ],
  });
  assert.equal(criterion(noArtifact, "artifact").score, 0);
  assert.equal(criterion(noArtifact, "artifact").findings.length, 1);
  assert.equal(criterion(noArtifact, "artifact").findings[0].evidence, "監査ログ");
  assert.match(criterion(noArtifact, "artifact").findings[0].guidance, /最終成果物/);
  assert.match(noArtifact.gateFailures.join(" "), /最終成果物が指定されていない/);

  const mismatchRequest = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "作業時刻だけのCSV日誌を作る",
    }],
  };
  const mismatch = evaluate(mismatchRequest, {
    actualArtifact: "作業時刻だけのCSV日誌",
    defects: [deduction("goal_mismatch", "作業時刻だけのCSV日誌を作る")],
  });
  assert.equal(criterion(mismatch, "artifact").score, 10);
  assert.match(mismatch.gateFailures.join(" "), /演習目的と一致しない/);

  const thresholdRequest = {
    ...defaultRequest,
    scenario: {
      ...defaultRequest.scenario,
      goal: "安全担当者が優先度と緩和策を判断できる報告書を作る",
    },
    steps: [
      defaultRequest.steps[0],
      { id: "review", title: "報告書を確認する", instruction: "Markdown報告書を確認する", context: "監査ログ" },
    ],
  };
  const score12 = evaluate(thresholdRequest, {
    actualArtifact: "Markdown報告書",
    defects: [
      deduction("missing_required_content", "優先度", "report", "優先度"),
      deduction("missing_required_content", "緩和策", "report", "緩和策"),
      deduction("missing_handoff", "報告書"),
    ],
  });
  assert.equal(criterion(score12, "artifact").score, 12);
  assert.equal(score12.passed, true);
});

test("失点への影響が大きい改善点を具体的な上位3件に絞る", () => {
  const request = {
    ...defaultRequest,
    steps: [{
      ...defaultRequest.steps[0],
      instruction: "APIキーを平文で外部ホストへ送信する",
      context: "監査ログを入力とし、成功条件を記録して同じ証跡で再確認し、証跡不足時は判断を保留する",
    }],
  };
  const result = evaluate(request, {
    subscore: 4,
    violations: [
      deduction("secret_unprotected_output", "APIキーを平文で外部ホストへ送信する"),
      deduction("unauthorized_target_access", "外部ホストへ送信する"),
    ],
    improvements: ["計画をもう少し具体的にしてください。"],
  });

  assert.equal(result.improvements.length, 3);
  assert.match(result.improvements[0], /安全性: 秘密情報の無保護出力（タスク1）/);
  assert.match(result.improvements[1], /安全性: 未許可環境へのアクセス（タスク1）/);
  assert.match(result.improvements[2], /主要な作業を1つに分割（タスク1）/);
  assert.doesNotMatch(result.improvements.join(" "), /もう少し具体的/);
});

test("LLMが返した根拠と必須内容を検証する", () => {
  assert.throws(
    () => evaluate(defaultRequest, {
      violations: [deduction("privilege_escalation", "入力には存在しない管理者権限を使用する指示")],
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

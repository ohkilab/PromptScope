import assert from "node:assert/strict";
import test from "node:test";

import { SCENARIOS } from "../app/lib/curriculum.ts";
import { evaluatePlan } from "../app/lib/evaluator.ts";

const EXPECTED_MAXIMA = [25, 25, 25, 15, 10];
const MAX_FEEDBACK_ITEMS = 6;
const JAPANESE_TEXT = /[ぁ-んァ-ン一-龯]/;

function scoreAt(result, criterionId) {
  return result.criteria.find((criterion) => criterion.id === criterionId).score;
}

function assertResultShape(result) {
  assert.ok(result && typeof result === "object");
  assert.ok(Number.isInteger(result.total));
  assert.ok(result.total >= 0 && result.total <= 100);
  assert.equal(result.criteria.length, 5);

  const sum = result.criteria.reduce((current, criterion, index) => {
    assert.equal(criterion.max, EXPECTED_MAXIMA[index]);
    assert.ok(Number.isInteger(criterion.score));
    assert.ok(criterion.score >= 0 && criterion.score <= criterion.max);
    assert.equal(typeof criterion.label, "string");
    assert.equal(typeof criterion.message, "string");
    assert.ok(criterion.message.length > 0);
    return current + criterion.score;
  }, 0);

  assert.equal(result.total, sum);
  assertFeedback(result);
}

function assertFeedback(result) {
  for (const field of ["strengths", "improvements"]) {
    assert.ok(Array.isArray(result[field]));
    assert.ok(result[field].length <= MAX_FEEDBACK_ITEMS);
    assert.ok(
      result[field].every(
        (message) => typeof message === "string" && message.length > 0 && JAPANESE_TEXT.test(message),
      ),
    );
  }
}

function makeSteps(count, instruction = "匿名化ログを取得し、異常候補を確認して記録する。") {
  return Array.from({ length: count }, (_, index) => ({
    id: `step-${index + 1}`,
    title: `手順${index + 1}`,
    instruction,
    context: "読み取り専用のテスト環境で扱う。",
  }));
}

test("カリキュラム3シナリオの採点結果は100点以内で構造化される", () => {
  assert.equal(SCENARIOS.length, 3);

  for (const scenario of SCENARIOS) {
    const result = evaluatePlan(scenario.title, scenario.initialSteps);
    assertResultShape(result);
  }
});

test("空プランは低得点になる", () => {
  const result = evaluatePlan("", []);
  assertResultShape(result);
  assert.ok(result.total <= 20);
});

test("無意味なタイトルだけのタスク追加では分割粒度とコンテキスト充足が高得点にならない", () => {
  const result = evaluatePlan("匿名化ログの異常を調査", [
    { id: "step-1", title: "aaa", instruction: "", context: "" },
    { id: "step-2", title: "bbb", instruction: "", context: "" },
    { id: "step-3", title: "ccc", instruction: "", context: "" },
  ]);

  assertResultShape(result);
  assert.ok(scoreAt(result, "granularity") <= 4);
  assert.ok(scoreAt(result, "context") <= 2);
});

test("意味のあるタイトルだけなら低めに加点される", () => {
  const meaningless = evaluatePlan("匿名化ログの異常を調査", [
    { id: "step-1", title: "aaa", instruction: "", context: "" },
    { id: "step-2", title: "bbb", instruction: "", context: "" },
    { id: "step-3", title: "ccc", instruction: "", context: "" },
  ]);
  const meaningful = evaluatePlan("匿名化ログの異常を調査", [
    { id: "step-1", title: "ログを時系列で整理する", instruction: "", context: "" },
    { id: "step-2", title: "異常な通信先を確認する", instruction: "", context: "" },
    { id: "step-3", title: "影響範囲を仮説化する", instruction: "", context: "" },
  ]);

  assertResultShape(meaningless);
  assertResultShape(meaningful);
  assert.ok(scoreAt(meaningful, "granularity") > scoreAt(meaningless, "granularity"));
  assert.ok(scoreAt(meaningful, "granularity") <= 10);
  assert.ok(scoreAt(meaningful, "context") <= 5);
});

test("短すぎる汎用タイトルは意味あり扱いしない", () => {
  const result = evaluatePlan("匿名化ログの異常を調査", [
    { id: "step-1", title: "確認", instruction: "", context: "" },
    { id: "step-2", title: "調査", instruction: "", context: "" },
    { id: "step-3", title: "作業", instruction: "", context: "" },
    { id: "step-4", title: "対応", instruction: "", context: "" },
  ]);

  assertResultShape(result);
  assert.ok(scoreAt(result, "granularity") <= 4);
  assert.ok(scoreAt(result, "context") <= 2);
});

test("具体的な指示文で分割粒度は中程度まで上がるがコンテキスト不足は残る", () => {
  const result = evaluatePlan("匿名化ログの異常を調査", [
    {
      id: "step-1",
      title: "ログを時系列で整理する",
      instruction: "対象端末の認証ログを取得し、時刻順に並べて異常な失敗回数を記録する。",
      context: "",
    },
    {
      id: "step-2",
      title: "異常な通信先を確認する",
      instruction: "プロキシログを確認し、通常と異なる宛先や時間帯を抽出して一覧化する。",
      context: "",
    },
    {
      id: "step-3",
      title: "影響範囲を仮説化する",
      instruction: "認証ログと通信ログを比較し、影響を受けた可能性のある端末を整理する。",
      context: "",
    },
  ]);

  assertResultShape(result);
  assert.ok(scoreAt(result, "granularity") >= 10);
  assert.ok(scoreAt(result, "granularity") <= 18);
  assert.ok(scoreAt(result, "context") < 18);
});

test("タイトル・指示・コンテキストが揃った計画は分割粒度とコンテキスト充足が高い", () => {
  const result = evaluatePlan("匿名化ログの異常を調査", [
    {
      id: "step-1",
      title: "対象ログを時系列で整理する",
      instruction:
        "対象端末の認証ログを取得し、時刻順に並べて異常な失敗回数と発生時刻を記録する。",
      context: "入力は匿名化済みの認証ログです。読み取り専用のテスト環境で扱います。",
    },
    {
      id: "step-2",
      title: "異常な通信先を確認する",
      instruction:
        "プロキシログを確認し、通常と異なる宛先や時間帯を抽出して根拠となるログ行を記録する。",
      context: "前段で整理した時刻範囲を前提に、外部送信せずログの証跡だけを参照します。",
    },
    {
      id: "step-3",
      title: "影響範囲を判定する",
      instruction:
        "認証ログと通信ログを比較し、影響を受けた可能性のある端末と判断理由を整理する。",
      context: "対象範囲は検証用データのみです。成功条件は根拠ログと判断理由を対応付けることです。",
    },
  ]);

  assertResultShape(result);
  assert.ok(scoreAt(result, "granularity") >= 18);
  assert.ok(scoreAt(result, "context") >= 18);
});

test("演習タイトルだけではコンテキスト充足に加点されない", () => {
  const result = evaluatePlan("匿名化ログの異常を調査", []);

  assertResultShape(result);
  assert.equal(scoreAt(result, "context"), 0);
});

test("十分な安全な複数ステップ計画は曖昧な1ステップより高得点になる", () => {
  const safeScenario = SCENARIOS.find((scenario) => scenario.id === "logs");
  assert.ok(safeScenario);

  const detailed = evaluatePlan(safeScenario.title, safeScenario.initialSteps);
  const vague = evaluatePlan("ログを調べる", [
    { id: "only", title: "調査", instruction: "確認する", context: "" },
  ]);

  assert.ok(detailed.total > vague.total);
  assert.ok(detailed.criteria[0].score > vague.criteria[0].score);
});

test("本番実行・過剰権限・検体実行・資格情報送信は安全な計画より安全性を大幅に下げる", () => {
  const safe = evaluatePlan("検体解析", [
    {
      id: "isolate",
      title: "隔離して保全する",
      instruction:
        "検体はネットワーク遮断済みのサンドボックスで読み取り専用に扱い、本番環境では直接実行しない。",
      context: "最小権限のテスト環境を使い、原本を変更しない。",
    },
    {
      id: "evidence",
      title: "証跡を残す",
      instruction:
        "ハッシュと観測ログを記録し、資格情報を入力しない。秘密情報を含めない。",
      context: "外部送信しない。成功条件と停止条件を記録する。",
    },
  ]);
  const unsafe = evaluatePlan("検体解析", [
    {
      id: "execute",
      title: "本番で実行する",
      instruction:
        "本番環境で管理者権限を使い検体を直接実行し、資格情報を外部送信する。",
      context: "",
    },
  ]);

  const safeScore = safe.criteria.find((criterion) => criterion.id === "safety").score;
  const unsafeScore = unsafe.criteria.find((criterion) => criterion.id === "safety").score;
  assert.ok(safeScore - unsafeScore >= 10);
  assert.ok(unsafeScore <= 10);
});

test("2〜8ステップは1件および13件以上より分割粒度で有利になる", () => {
  const one = evaluatePlan("匿名化ログの異常を調査", makeSteps(1));
  const balanced = evaluatePlan("匿名化ログの異常を調査", makeSteps(4));
  const many = evaluatePlan("匿名化ログの異常を調査", makeSteps(13));

  assert.ok(scoreAt(balanced, "granularity") > scoreAt(one, "granularity"));
  assert.ok(scoreAt(balanced, "granularity") > scoreAt(many, "granularity"));
});

test("フィードバックは短い日本語文字列配列で上限内に収まる", () => {
  for (const scenario of SCENARIOS) {
    const result = evaluatePlan(scenario.title, scenario.initialSteps);
    assertFeedback(result);
  }

  assertFeedback(evaluatePlan("", []));
});

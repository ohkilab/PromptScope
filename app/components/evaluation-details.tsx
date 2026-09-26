import * as Accordion from "@radix-ui/react-accordion";
import type { AnalysisStep, EvaluationCheck, EvaluationResult, Evidence } from "../lib/evaluator";
import { CRITERION_SPECS } from "../lib/evaluator";
import { PENALTY_SPECS, SCORING_GUIDE, STATUS_LABELS, rubricFor, type RubricScenarioId } from "../lib/rubric";

function EvidenceList({ evidence, steps }: { evidence: Evidence[]; steps: AnalysisStep[] }) {
  if (!evidence.length) return null;
  return <ul className="evidence-list">{evidence.map((item, index) => {
    const number = steps.findIndex((step) => step.id === item.stepId);
    return <li key={index}>
      <span>{number >= 0 ? `タスク${number + 1}` : "前回採点のタスク"} / {item.field === "instruction" ? "指示" : "コンテキスト"}</span>
      <blockquote>{item.quote}</blockquote>
    </li>;
  })}</ul>;
}

export function RubricGuide({ scenarioId }: { scenarioId: RubricScenarioId }) {
  const rubric = rubricFor(scenarioId);
  return <details className="rubric-guide">
    <summary>加点・減点・合格条件を見る</summary>
    <p>{SCORING_GUIDE}</p>
    <p>回答の指示・コンテキストに書かれた内容を評価します。設問やタイトルだけでは加点しません。共通の制約は、全タスクに適用すると明記できます。</p>
    {CRITERION_SPECS.map((axis) => <div key={axis.id}>
      <h3>{axis.label} <small>20点</small></h3>
      <ul>{rubric.filter((item) => item.criterion === axis.id).map((item) => <li key={item.id}>
        <strong>{item.required && <span className="required-tag">必須</span>}{item.label}（{item.max}点）</strong>
        <p>{item.description}</p>
        {item.allSteps && <small>すべてのタスクで具体化してください。</small>}
      </li>)}</ul>
    </div>)}
    <h3>減点条件</h3>
    <ul>{PENALTY_SPECS.map((item) => <li key={item.id}>
      <strong>{item.label}：−{item.points}点{item.cap < 100 ? `・最大${item.cap}点` : ""}</strong><p>{item.description}</p>
    </li>)}</ul>
    <p>本文が空のタスクが残る場合は最大49点。課題に対応しない回答は0点、関連語だけの抽象的な計画は最大29点です。</p>
  </details>;
}

export function CheckDetails({ checks, steps }: { checks: EvaluationCheck[]; steps: AnalysisStep[] }) {
  return <Accordion.Root className="step-evaluation" type="single" collapsible>
    <Accordion.Item value="checks">
      <Accordion.Header className="step-evaluation-header">
        <Accordion.Trigger className="step-evaluation-trigger">
          <span>加点の根拠・不足を見る</span><span aria-hidden="true">⌄</span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="step-evaluation-content">
        <ul className="check-list">{checks.map((check) => <li key={check.id}>
          <div className="check-heading"><strong>{check.required && <span className="required-tag">必須</span>}{check.label}</strong><span>{check.score}/{check.max}点</span></div>
          <span className={`check-status check-${check.status}`}>{STATUS_LABELS[check.status]}</span>
          <p>{check.reason}</p>
          <EvidenceList evidence={check.evidence} steps={steps} />
        </li>)}</ul>
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>;
}

export function ScoreBreakdown({ result, steps }: { result: EvaluationResult; steps: AnalysisStep[] }) {
  return <div className="score-breakdown">
    <dl><div><dt>加点合計</dt><dd>{result.earned} / 100</dd></div><div><dt>減点</dt><dd>−{result.deduction}</dd></div><div><dt>適用上限</dt><dd>{result.scoreCap}点</dd></div></dl>
    {result.capReasons.length > 0 && <ul className="cap-reasons">{result.capReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    {result.requiredMissing.length > 0 && <p><strong>残っている必須項目：</strong>{result.requiredMissing.join("、")}</p>}
    {result.penalties.length > 0 && <details className="penalty-details"><summary>減点理由と該当箇所（{result.penalties.length}件）</summary>
      <ul>{result.penalties.map((item) => <li key={item.id}><strong>{item.label}：−{item.points}点</strong><p>{item.reason}</p><EvidenceList evidence={item.evidence} steps={steps} /></li>)}</ul>
    </details>}
  </div>;
}

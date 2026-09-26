import { CRITERION_SPECS } from "../lib/evaluator";
import { evaluationContext, type EvaluationProfile } from "../lib/exercises";

export function EvaluationProfileDetails({ profile }: { profile: EvaluationProfile }) {
  const context = evaluationContext(profile);
  return <details className="evaluation-profile-details">
    <summary>この問題の評価観点・参照事例</summary>
    <p>共通の5軸・100点の採点に、以下の確認項目を加えます。事例の教訓は問題に当てはまる範囲で適用します。</p>
    <dl>{context.focus.map((item) => <div key={item.criterion}><dt>{item.label}</dt><dd>{item.description}</dd></div>)}</dl>
    {context.incidents.map((incident) => <section key={incident.id}>
      <h3>{incident.title}</h3><p>{incident.summary}</p>
      <a href={incident.url} target="_blank" rel="noreferrer">出典：{incident.source} · {incident.published} ↗</a>
      <ul>{incident.lessons.map((lesson, index) => <li key={index}>{CRITERION_SPECS.find(({ id }) => id === lesson.criterion)?.label}：{lesson.description}</li>)}</ul>
    </section>)}
    {context.userReferences.map((reference, index) => <section key={index}>
      <h3>{reference.title}</h3><a href={reference.url} target="_blank" rel="noreferrer">出典を開く ↗</a>
      <p>{reference.excerpt}</p><p className="exercise-help">利用者の要約・抜粋を参照します。URLの本文は取得・検証していません。</p>
    </section>)}
  </details>;
}

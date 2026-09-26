"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CRITERION_SPECS } from "../lib/evaluator";
import {
  defaultEvaluationFocus, EXERCISE_DOMAINS, newCustomExerciseInput,
  parseCustomExerciseInput, parseEvaluationFocus,
  type CustomExerciseInput, type CustomScenario, type ExerciseDomain,
} from "../lib/exercises";
import { INCIDENT_REFERENCES } from "../lib/incidents";

type Props = {
  scenario: CustomScenario | null;
  onSave: (input: CustomExerciseInput) => void;
  onDelete: () => void;
  onClose: () => void;
};

export function ExerciseEditor({ scenario, onSave, onDelete, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState<CustomExerciseInput>(() => scenario ? {
    title: scenario.title, description: scenario.description, goal: scenario.goal,
    environment: scenario.environment, materials: scenario.materials,
    evaluationProfile: structuredClone(scenario.evaluationProfile),
  } : newCustomExerciseInput());
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const suggestionAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { suggestionAbort.current?.abort(); element?.close(); };
  }, []);

  function changeField(field: keyof Omit<CustomExerciseInput, "evaluationProfile">, value: string) {
    setError("");
    setInput((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { onSave(parseCustomExerciseInput(input)); } catch (error) {
      setError(error instanceof Error ? error.message : "問題を保存できませんでした。");
    }
  }

  async function suggestFocus() {
    if (suggesting) return;
    setError("");
    let validated: CustomExerciseInput;
    try { validated = parseCustomExerciseInput(input); } catch (error) {
      setError(error instanceof Error ? error.message : "問題文を入力してください。");
      return;
    }
    const controller = new AbortController();
    suggestionAbort.current = controller;
    setSuggesting(true);
    setSuggestionMessage("目的と参照事例から評価観点を提案しています…");
    try {
      const response = await fetch("/api/exercises/suggest-focus", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated), signal: controller.signal,
      });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error || "評価観点を取得できませんでした。");
      const focus = parseEvaluationFocus(payload.focus);
      setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, focus } }));
      setSuggestionMessage("提案を反映しました。各観点を確認・編集してから保存してください。");
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : "提案に失敗しました。");
      setSuggestionMessage("");
    } finally {
      if (!controller.signal.aborted) setSuggesting(false);
    }
  }

  return <dialog className="exercise-editor" ref={dialog} aria-labelledby="exercise-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={submit}>
      <div className="exercise-editor-heading">
        <div><p className="mono-label accent-label">目的に合わせた演習</p><h2 id="exercise-editor-title">{scenario ? "問題と評価観点を編集" : "自分の問題を作る"}</h2></div>
        <button className="button button-complete" type="button" onClick={onClose}>閉じる</button>
      </div>
      <p className="exercise-editor-intro">問題文と使える材料を用意し、AI に渡す分析計画を練習します。問題と回答はこのブラウザーに保存されます。</p>
      <fieldset disabled={suggesting} className="exercise-fields">
        <legend>問題の設定</legend>
        <div className="field"><label htmlFor="exercise-title">問題タイトル</label><input id="exercise-title" required maxLength={240} value={input.title} onChange={(event) => changeField("title", event.target.value)} placeholder="例：クラウド監査ログから不審なデータアクセスを調べる" /></div>
        <div className="field"><label htmlFor="exercise-domain">演習分野</label><select id="exercise-domain" value={input.evaluationProfile.domain} onChange={(event) => {
          const domain = event.target.value as ExerciseDomain;
          setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, domain, focus: defaultEvaluationFocus(domain) } }));
          setSuggestionMessage("");
        }}>{EXERCISE_DOMAINS.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select><p className="field-hint">分野を変えると、5軸の評価観点をその分野の標準値に置き換えます。</p></div>
        {([
          ["description", "状況・問題文", 1_500, "起きていること、利用者の役割、調べたい問いを書いてください。"],
          ["goal", "学習目的・期待する成果", 1_500, "何を判断できるようになりたいか、成果物と完了条件を書いてください。"],
          ["environment", "環境・権限・制約", 2_000, "使える証跡、調査範囲、権限、許可する操作を明記してください。"],
          ["materials", "入力データ・配布資料（任意）", 4_000, "架空・匿名化したログ、構成情報など。実在する秘密値や個人情報は入力しないでください。"],
        ] as const).map(([field, label, maxLength, placeholder]) => <div className="field" key={field}>
          <label htmlFor={`exercise-${field}`}>{label}</label><textarea id={`exercise-${field}`} required={field !== "materials"} maxLength={maxLength} value={input[field]} onChange={(event) => changeField(field, event.target.value)} placeholder={placeholder} />
        </div>)}
      </fieldset>

      <fieldset disabled={suggesting} className="exercise-fields">
        <legend>実際のインシデントを参照する（任意）</legend>
        <p className="exercise-help">選んだ事例の教訓を、該当する評価軸の確認項目に追加します。教訓は公開報告をもとにした教材上の解釈です。</p>
        <div className="incident-options">{INCIDENT_REFERENCES.map((incident) => <div className="incident-option" key={incident.id}>
          <label><input type="checkbox" checked={input.evaluationProfile.incidentIds.includes(incident.id)} onChange={(event) => {
            const checked = event.target.checked;
            setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile,
              incidentIds: checked ? [...current.evaluationProfile.incidentIds, incident.id] : current.evaluationProfile.incidentIds.filter((id) => id !== incident.id),
            } }));
          }} /><strong>{incident.title}</strong></label>
          <p>{incident.summary}</p><a href={incident.url} target="_blank" rel="noreferrer">出典：{incident.source} · {incident.published} ↗</a>
          <ul>{incident.lessons.map((lesson, index) => <li key={index}>{CRITERION_SPECS.find(({ id }) => id === lesson.criterion)?.label}：{lesson.description}</li>)}</ul>
        </div>)}</div>
        <h3>独自の参照資料</h3>
        <p className="exercise-help">公開資料のURLと要約・抜粋を入力できます。URLの本文は自動取得しません。入力した要約を評価の参考にします。</p>
        {input.evaluationProfile.references.map((reference, index) => <div className="reference-fields" key={index}>
          {(["title", "url", "excerpt"] as const).map((field) => <div className="field" key={field}>
            <label htmlFor={`reference-${index}-${field}`}>資料{index + 1} · {field === "title" ? "タイトル" : field === "url" ? "出典URL（HTTPS）" : "要約・抜粋と問題への関連"}</label>
            {field === "excerpt" ? <textarea id={`reference-${index}-${field}`} required maxLength={1_500} value={reference[field]} onChange={(event) => {
              const value = event.target.value;
              setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, references: current.evaluationProfile.references.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) } }));
            }} /> : <input id={`reference-${index}-${field}`} required type={field === "url" ? "url" : "text"} maxLength={field === "url" ? 2_000 : 240} value={reference[field]} onChange={(event) => {
              const value = event.target.value;
              setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, references: current.evaluationProfile.references.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) } }));
            }} />}
          </div>)}
          <button className="button button-complete" type="button" onClick={() => setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, references: current.evaluationProfile.references.filter((_, itemIndex) => itemIndex !== index) } }))}>この資料を外す</button>
        </div>)}
        <button className="button button-complete" type="button" disabled={input.evaluationProfile.references.length >= 3} onClick={() => setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, references: [...current.evaluationProfile.references, { title: "", url: "", excerpt: "" }] } }))}>＋ 参照資料を追加（最大3件）</button>
      </fieldset>

      <fieldset disabled={suggesting} className="exercise-fields">
        <legend>問題に応じた評価観点</legend>
        <p className="exercise-help">各軸の確認項目を変更・追加できます。共通の5軸・各20点と安全上の基準に、これらの観点と事例の教訓を加えて採点します。</p>
        <div className="exercise-editor-actions">
          <button className="button button-secondary" type="button" onClick={suggestFocus} disabled={suggesting} aria-busy={suggesting}>{suggesting ? "評価観点を提案中…" : "目的と事例から評価観点を提案"}</button>
          <button className="button button-complete" type="button" onClick={() => {
            setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, focus: defaultEvaluationFocus(current.evaluationProfile.domain) } }));
            setSuggestionMessage("");
          }}>分野の標準観点に戻す</button>
        </div>
        <p className="exercise-help">提案時には問題文・入力資料・参照情報を設定済みのLLMへ送信します。手入力だけでも保存できます。</p>
        {CRITERION_SPECS.map(({ id, label }) => <div className="field" key={id}><label htmlFor={`focus-${id}`}>{label} · 20点</label><textarea id={`focus-${id}`} maxLength={600} value={input.evaluationProfile.focus[id]} onChange={(event) => {
          const value = event.target.value;
          setInput((current) => ({ ...current, evaluationProfile: { ...current.evaluationProfile, focus: { ...current.evaluationProfile.focus, [id]: value } } }));
        }} /></div>)}
      </fieldset>
      <p role="status" aria-live="polite">{suggestionMessage}</p>
      {suggesting && <button className="button button-complete" type="button" onClick={() => {
        suggestionAbort.current?.abort(); setSuggesting(false); setSuggestionMessage("提案をキャンセルしました。評価観点を手入力できます。");
      }}>提案をキャンセル</button>}
      {error && <p className="evaluation-error" role="alert">{error}</p>}
      <div className="exercise-editor-footer">
        <button className="button button-score" type="submit" disabled={suggesting}>{scenario ? "変更を保存" : "問題を保存して演習を始める"}</button>
        {scenario && (confirmDelete ? <div className="delete-confirmation"><p>この問題と保存された回答を削除します。</p><button className="button button-danger" type="button" onClick={onDelete}>削除する</button><button className="button button-complete" type="button" onClick={() => setConfirmDelete(false)}>キャンセル</button></div> : <button className="button button-danger" type="button" disabled={suggesting} onClick={() => setConfirmDelete(true)}>この問題を削除</button>)}
      </div>
    </form>
  </dialog>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisStep } from "./lib/evaluator";
import { evaluatePlan } from "./lib/evaluator";
import type { ScenarioId } from "./lib/curriculum";
import { SCENARIOS } from "./lib/curriculum";
import { TUTORIAL_ANSWER, TUTORIAL_INPUT, TUTORIAL_SCENARIO, TUTORIAL_STEPS } from "./lib/tutorial";
import type { TutorialStepId } from "./lib/tutorial";
import { TutorialCoach, Welcome } from "./components/tutorial";

type PlanEvaluation = ReturnType<typeof evaluatePlan>;

type ScenarioRecord = {
  id: ScenarioId | "tutorial";
  eyebrow: string;
  title: string;
  description: string;
  goal: string;
  environment: string;
  riskLabel: string;
  duration: string;
  initialSteps: AnalysisStep[];
};

type DraftStep = {
  id: string;
  title: string;
  instruction: string;
  context: string;
};

type CompletionState = "idle" | "needs-work" | "complete";

type ScenarioDraftState = {
  steps: DraftStep[];
  selectedStepId: string;
  scoredEvaluation: PlanEvaluation | null;
  hasUnscoredChanges: boolean;
  completionState: CompletionState;
};

const scenarioList = SCENARIOS;
const EMPTY_STEPS: DraftStep[] = [];

function getStepValue(step: AnalysisStep, key: string, fallback = "") {
  const values = step as unknown as Record<string, unknown>;
  const value = values[key];
  return typeof value === "string" ? value : fallback;
}

function toDraftStep(step: AnalysisStep, index: number): DraftStep {
  return {
    id: getStepValue(step, "id", `step-${index + 1}`),
    title: getStepValue(step, "title", `分析タスク ${index + 1}`),
    instruction: getStepValue(step, "instruction", getStepValue(step, "prompt")),
    context: getStepValue(step, "context", getStepValue(step, "handoff")),
  };
}

function toAnalysisSteps(steps: DraftStep[]) {
  return steps.map((step) => ({
    id: step.id,
    title: step.title,
    instruction: step.instruction,
    context: step.context,
  })) as unknown as AnalysisStep[];
}

function scenarioInitialSteps(scenario: ScenarioRecord) {
  return scenario.initialSteps.map(toDraftStep);
}

function createScenarioDraft(scenario: ScenarioRecord): ScenarioDraftState {
  const steps = scenarioInitialSteps(scenario);
  return {
    steps,
    selectedStepId: steps[0]?.id ?? "",
    scoredEvaluation: null,
    hasUnscoredChanges: false,
    completionState: "idle",
  };
}

function scoreTone(score: number) {
  if (score >= 80) return "good";
  if (score >= 60) return "mid";
  return "low";
}

export default function Home() {
  const [view, setView] = useState<"welcome" | "tutorial" | "exercise">("welcome");
  const [tutorialIndex, setTutorialIndex] = useState(0);
  const [tutorialDraft, setTutorialDraft] = useState(() => createScenarioDraft(TUTORIAL_SCENARIO));
  const workspaceTitle = useRef<HTMLHeadingElement>(null);
  const isTutorial = view === "tutorial";
  const tutorialStep = TUTORIAL_STEPS[tutorialIndex].id;

  useEffect(() => {
    if (view === "exercise") {
      workspaceTitle.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [view]);

  function startTutorial() {
    setTutorialDraft(createScenarioDraft(TUTORIAL_SCENARIO));
    setTutorialIndex(0);
    setView("tutorial");
    setLiveMessage("専用の例題で使い方を練習します．演習の回答は保持されています．");
  }

  function openExercise() {
    setView("exercise");
    setLiveMessage("演習の回答を編集できます．使い方はいつでも開き直せます．");
  }

  function guide(id: TutorialStepId) {
    if (!isTutorial || tutorialStep !== id) return null;
    return <TutorialCoach
      key={id}
      index={tutorialIndex}
      onBack={() => setTutorialIndex((current) => Math.max(0, current - 1))}
      onNext={() => tutorialIndex === TUTORIAL_STEPS.length - 1 ? openExercise() : setTutorialIndex((current) => current + 1)}
      nextDisabled={id === "score" && (!scoredEvaluation || hasUnscoredChanges)}
      onExample={id === "instruction" || id === "context" ? () => {
        if (steps[0]) updateStep(steps[0].id, id, TUTORIAL_ANSWER[id]);
        setLiveMessage("回答例を入力しました．内容を確認し，自由に書き換えてみましょう．");
      } : undefined}
    />;
  }

  function target(id: TutorialStepId) {
    return isTutorial && tutorialStep === id ? " tutorial-target" : "";
  }

  const firstScenario =
    scenarioList.find(
      (scenario) =>
        /malware|マルウェア|マルウエア/i.test(
          `${String(scenario.id)} ${scenario.title}`,
        ),
    ) ?? scenarioList[0];

  const [scenarioId, setScenarioId] = useState<ScenarioId>(
    () => firstScenario?.id ?? ("malware" as ScenarioId),
  );
  const activeScenario = isTutorial ? TUTORIAL_SCENARIO :
    scenarioList.find((scenario) => scenario.id === scenarioId) ?? firstScenario;
  const [draftsByScenario, setDraftsByScenario] = useState<Partial<Record<ScenarioId, ScenarioDraftState>>>(() =>
    firstScenario ? { [firstScenario.id]: createScenarioDraft(firstScenario) } : {},
  );
  const [liveMessage, setLiveMessage] = useState(
    "回答を書き終えたら、計画を採点してください。",
  );
  const activeDraft = activeScenario
    ? activeScenario.id === "tutorial" ? tutorialDraft : draftsByScenario[activeScenario.id] ?? createScenarioDraft(activeScenario)
    : null;
  const steps = activeDraft?.steps ?? EMPTY_STEPS;
  const selectedStepId = activeDraft?.selectedStepId ?? "";
  const scoredEvaluation = activeDraft?.scoredEvaluation ?? null;
  const hasUnscoredChanges = activeDraft?.hasUnscoredChanges ?? false;
  const completionState = activeDraft?.completionState ?? "idle";

  const evaluation = activeScenario
    ? evaluatePlan(activeScenario.title, toAnalysisSteps(steps))
    : { total: 0, criteria: [], strengths: [], improvements: [] };

  if (view === "welcome") {
    return <Welcome onTutorial={startTutorial} onExercise={openExercise} />;
  }

  if (!activeScenario) {
    return (
      <main className="empty-app">
        <p className="mono-label">PROMPT SCOPE / 00</p>
        <h1>演習を読み込めませんでした。</h1>
      </main>
    );
  }

  const displayedScore = scoredEvaluation ? Math.round(scoredEvaluation.total) : null;
  const displayedCriteria = scoredEvaluation?.criteria ?? [];
  const displayedPassed = displayedScore !== null && displayedScore >= 80;
  const scoreStatus = !scoredEvaluation
    ? "未採点"
    : hasUnscoredChanges
      ? "前回採点 / 再採点待ち"
      : displayedPassed
        ? "PASS / 目標達成"
        : "DRAFT / 改善中";
  const summaryTone = displayedScore === null ? "unscored" : scoreTone(displayedScore);

  function updateActiveDraft(
    update: (current: ScenarioDraftState) => ScenarioDraftState,
  ) {
    if (!activeScenario) return;
    if (activeScenario.id === "tutorial") {
      setTutorialDraft(update);
      return;
    }
    const activeId = activeScenario.id;
    setDraftsByScenario((current) => {
      const currentDraft = current[activeId] ?? createScenarioDraft(activeScenario);
      return {
        ...current,
        [activeId]: update(currentDraft),
      };
    });
  }

  function updateStep(
    stepId: string,
    field: keyof Omit<DraftStep, "id">,
    value: string,
  ) {
    updateActiveDraft((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.id === stepId ? { ...step, [field]: value } : step,
      ),
      hasUnscoredChanges: true,
      completionState: "idle",
    }));
  }

  function selectStep(stepId: string) {
    updateActiveDraft((current) => ({
      ...current,
      selectedStepId: stepId,
    }));
  }

  function switchScenario(nextScenario: (typeof SCENARIOS)[number]) {
    setScenarioId(nextScenario.id);
    setDraftsByScenario((current) => {
      if (current[nextScenario.id]) return current;
      return {
        ...current,
        [nextScenario.id]: createScenarioDraft(nextScenario),
      };
    });
    setLiveMessage("演習を切り替えました。前回の編集内容はこのセッション内に保持されます。");
  }

  function addStep() {
    const nextId = `step-${crypto.randomUUID()}`;
    const nextStep: DraftStep = {
      id: nextId,
      title: "新しい分析タスク",
      instruction: "何を確認し、どんな観測結果を返すかを具体的に書く。",
      context: "前のタスクの観測結果と、このタスクで必要な前提を渡す。",
    };
    updateActiveDraft((current) => ({
      ...current,
      steps: [...current.steps, nextStep],
      selectedStepId: nextId,
      hasUnscoredChanges: true,
      completionState: "idle",
    }));
    setLiveMessage("新しい分析タスクを追加しました。");
  }

  function removeStep(stepId: string) {
    if (steps.length <= 1) {
      setLiveMessage("計画には最低1つの分析タスクを残してください。");
      return;
    }
    const removedIndex = steps.findIndex((step) => step.id === stepId);
    const nextSteps = steps.filter((step) => step.id !== stepId);
    updateActiveDraft((current) => {
      const replacement = nextSteps[Math.min(removedIndex, nextSteps.length - 1)];
      return {
        ...current,
        steps: nextSteps,
        selectedStepId: stepId === selectedStepId ? replacement?.id ?? "" : current.selectedStepId,
        hasUnscoredChanges: true,
        completionState: "idle",
      };
    });
    setLiveMessage("分析タスクを削除しました。");
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    updateActiveDraft((current) => {
      const index = current.steps.findIndex((step) => step.id === stepId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.steps.length) return current;
      const next = [...current.steps];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return {
        ...current,
        steps: next,
        selectedStepId: stepId,
        hasUnscoredChanges: true,
        completionState: "idle",
      };
    });
  }

  function scorePlan() {
    const nextScore = Math.round(evaluation.total);
    const nextPassed = nextScore >= 80;
    updateActiveDraft((current) => ({
      ...current,
      scoredEvaluation: evaluation,
      hasUnscoredChanges: false,
    }));
    setLiveMessage(
      `計画を採点しました。総合スコアは ${nextScore} 点です。${nextPassed ? "合格ラインを超えています。" : "80点まで改善の余地があります。"}`,
    );
    if (isTutorial && tutorialStep === "score") setTutorialIndex((current) => current + 1);
  }

  function completeLearning() {
    if (!scoredEvaluation || hasUnscoredChanges || displayedScore === null) {
      updateActiveDraft((current) => ({
        ...current,
        completionState: "needs-work",
      }));
      setLiveMessage("学習を完了する前に、現在の計画を採点してください。");
      return;
    }

    if (displayedPassed) {
      updateActiveDraft((current) => ({
        ...current,
        completionState: "complete",
      }));
      setLiveMessage("学習を完了しました。安全な分析計画を組み立てられています。");
    } else {
      updateActiveDraft((current) => ({
        ...current,
        completionState: "needs-work",
      }));
      setLiveMessage(
        `まだ学習途中です。合格点の80点まで、${80 - displayedScore}点分の改善を試してみましょう。`,
      );
    }
  }

  return (
    <main className={`app-shell${isTutorial ? " tutorial-shell" : ""}`}>
      <header className="topbar">
        <div className="brand-lockup" aria-label="PromptScope">
          <span className="brand-mark" aria-hidden="true">PS</span>
          <span className="brand-name">PromptScope</span>
          <span className="brand-rule" aria-hidden="true" />
          <span className="brand-tagline">安全な分析は、よい分解から。</span>
        </div>
        <div className="topbar-meta">
          <span className="local-indicator" aria-hidden="true" />
          <span>学習モード</span>
          <span className="slash" aria-hidden="true">/</span>
          <span className="mono-label">LOCAL ONLY</span>
        </div>
      </header>

      <div className="learning-toolbar">
        {isTutorial ? <>
          <div><span className="mono-label accent-label">GUIDED EXAMPLE</span><strong>専用の例題で練習中</strong><span>{tutorialIndex + 1} / {TUTORIAL_STEPS.length}</span></div>
          <button className="button button-complete" type="button" onClick={openExercise}>ガイドを終了して演習へ</button>
        </> : <>
          <span>目的を読み，タスクと指示を組み立てましょう．</span>
          <button className="button button-complete" type="button" onClick={startTutorial}>使い方・例題を見る</button>
        </>}
      </div>

      <div className="workspace-grid">
        <aside className="left-column" aria-label="演習選択と学習の焦点">
          <div className="column-intro">
            <p className="mono-label">01 / EXERCISES</p>
            <h2>{isTutorial ? "使い方を学ぶ" : "演習を選ぶ"}</h2>
            <p className="column-description">{isTutorial ? "例題の編集や採点は演習に影響しません．途中でもガイドを終了できます．" : "危険な処理を実行せず、分解の仕方だけを練習します。"}</p>
          </div>

          {isTutorial ? <ol className="tutorial-outline" aria-label="使い方ガイドの流れ">
            {TUTORIAL_STEPS.map((step, index) => <li key={step.id} aria-current={index === tutorialIndex ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{step.title}</li>)}
          </ol> : <nav className="scenario-nav" aria-label="演習一覧">
            {scenarioList.map((scenario, index) => {
              const isActive = scenario.id === activeScenario.id;
              return (
                <button
                  className={`scenario-item${isActive ? " is-active" : ""}`}
                  key={String(scenario.id)}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => switchScenario(scenario)}
                >
                  <span className="scenario-index">0{index + 1}</span>
                  <span className="scenario-copy">
                    <span className="scenario-eyebrow">{scenario.eyebrow}</span>
                    <span className="scenario-title">{scenario.title}</span>
                  </span>
                  <span className="scenario-arrow" aria-hidden="true">↗</span>
                </button>
              );
            })}
          </nav>}

          <section className="focus-note" aria-labelledby="focus-heading">
            <div className="focus-heading-row">
              <p className="mono-label">LEARNING FOCUS</p>
              <span className="focus-pin" aria-hidden="true">✳</span>
            </div>
            <h2 id="focus-heading">学習の焦点</h2>
            <ol className="focus-list">
              <li><span>01</span><p>目的と完了条件を先に置く</p></li>
              <li><span>02</span><p>観測と判断を別のタスクに分ける</p></li>
              <li><span>03</span><p>権限・入力・出力の境界を明記する</p></li>
            </ol>
          </section>

          <div className="left-footer">
            <span className="safety-stamp">NO EXECUTION</span>
            <p>教育用プロトタイプ<br />実処理・API通信はありません</p>
          </div>
        </aside>

        <section className="center-column" aria-labelledby="workspace-title">
          <div className={`task-overview${target("overview")}`}>
            {guide("overview")}
            <div className="overview-heading">
              <div>
                <p className="mono-label accent-label">{activeScenario.eyebrow}</p>
                <h1 id="workspace-title" ref={workspaceTitle} tabIndex={-1}>{activeScenario.title}</h1>
              </div>
              <span className="scenario-count">{String(activeScenario.id).toUpperCase()}</span>
            </div>
            <p className="overview-description">{activeScenario.description}</p>
            <div className="overview-meta" aria-label="演習の概要">
              <div className="meta-block">
                <span className="mono-label">GOAL</span>
                <strong>{activeScenario.goal}</strong>
              </div>
              <div className="meta-block">
                <span className="mono-label">ENVIRONMENT</span>
                <strong>{activeScenario.environment}</strong>
              </div>
              <div className="meta-block meta-risk">
                <span className="mono-label">RISK / TIME</span>
                <strong><span>{activeScenario.riskLabel}</span><span className="meta-separator">·</span>{activeScenario.duration}</strong>
              </div>
            </div>
            {isTutorial && <div className="tutorial-input">
              <table><caption>入力データ / 昨日と今日のファイル一覧</caption><thead><tr><th scope="col">ファイル名</th><th scope="col">昨日（バイト）</th><th scope="col">今日（バイト）</th></tr></thead><tbody>
                {TUTORIAL_INPUT.map((row) => <tr key={row.file}><th scope="row">{row.file}</th><td>{row.before}</td><td>{row.after}</td></tr>)}
              </tbody></table>
              <p>この一覧をどう確認・比較・報告するかを，AI への指示として書きます．</p>
            </div>}
          </div>

          <div className={`progress-section${target("decompose")}`}>
            {guide("decompose")}
            <div className="section-heading">
              <div>
                <p className="mono-label">02 / DECOMPOSE</p>
                <h2>分解の進捗</h2>
              </div>
              <span className="progress-count">{String(steps.length).padStart(2, "0")} TASKS</span>
            </div>
            <ol className="progress-rail" aria-label="分析タスクの順序">
              {steps.map((step, index) => (
                <li className={step.id === selectedStepId ? "is-current" : ""} key={step.id}>
                  <button
                    type="button"
                    aria-label={`${index + 1}番目のタスク「${step.title || "無題"}」を選択`}
                    aria-current={step.id === selectedStepId ? "step" : undefined}
                    onClick={() => selectStep(step.id)}
                  >
                    <span className="rail-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="rail-title">{step.title || "無題のタスク"}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="task-list-heading">
            <div>
              <p className="mono-label">TASK PLAN</p>
              <h2>分析タスク</h2>
            </div>
            <p className="helper-copy">安全な順序と、Agentに渡す境界を設計します。</p>
          </div>

          <div className="task-list" aria-label="編集可能な分析タスク">
            {steps.length === 0 ? (
              <div className="empty-tasks">
                <p className="mono-label">NO TASKS YET</p>
                <p>最初の分析タスクを追加して計画を始めましょう。</p>
                <button className="button button-secondary" type="button" onClick={addStep}>＋ タスクを追加</button>
              </div>
            ) : (
              steps.map((step, index) => {
                const isSelected = step.id === selectedStepId;
                return (
                  <article
                    className={`task-card${isSelected ? " is-selected" : ""}`}
                    key={step.id}
                    tabIndex={0}
                    aria-label={`${index + 1}番目の分析タスク`}
                    onClick={() => selectStep(step.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "ArrowUp" && index > 0) {
                        event.preventDefault();
                        moveStep(step.id, -1);
                      }
                      if (event.key === "ArrowDown" && index < steps.length - 1) {
                        event.preventDefault();
                        moveStep(step.id, 1);
                      }
                    }}
                  >
                    <div className="task-card-header">
                      <button
                        className="task-card-select"
                        type="button"
                        aria-pressed={isSelected}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectStep(step.id);
                        }}
                      >
                        <span className="task-number">{String(index + 1).padStart(2, "0")}</span>
                        <span className="task-state">{isSelected ? "編集中" : "待機中"}</span>
                      </button>
                      <div className="task-actions" aria-label={`${index + 1}番目のタスク操作`}>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label="タスクを上へ移動"
                          disabled={index === 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveStep(step.id, -1);
                          }}
                        >↑</button>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label="タスクを下へ移動"
                          disabled={index === steps.length - 1}
                          onClick={(event) => {
                            event.stopPropagation();
                            moveStep(step.id, 1);
                          }}
                        >↓</button>
                        <button
                          className="icon-button icon-button-danger"
                          type="button"
                          aria-label="タスクを削除"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeStep(step.id);
                          }}
                        >×</button>
                      </div>
                    </div>

                    <div className="task-card-body">
                      <div className="field field-title">
                        <label htmlFor={`task-title-${step.id}`}>タスクタイトル</label>
                        <input
                          id={`task-title-${step.id}`}
                          value={step.title}
                          onFocus={() => selectStep(step.id)}
                          onChange={(event) => updateStep(step.id, "title", event.target.value)}
                          placeholder="例：入力ファイルの由来を確認する"
                        />
                      </div>
                      <div className="task-fields-grid">
                        <div className={`field${index === 0 ? target("instruction") : ""}`}>
                          {index === 0 && guide("instruction")}
                          <label htmlFor={`task-instruction-${step.id}`}>
                            <span className="field-index">A</span>Agentへの指示
                          </label>
                          <textarea
                            id={`task-instruction-${step.id}`}
                            value={step.instruction}
                            onFocus={() => selectStep(step.id)}
                            onChange={(event) => updateStep(step.id, "instruction", event.target.value)}
                            rows={4}
                            placeholder="対象、観察ポイント、禁止事項、期待する出力形式を書く"
                          />
                          <span className="field-hint">何をするか / 何をしないか</span>
                        </div>
                        <div className={`field${index === 0 ? target("context") : ""}`}>
                          {index === 0 && guide("context")}
                          <label htmlFor={`task-context-${step.id}`}>
                            <span className="field-index">B</span>渡すコンテキスト
                          </label>
                          <textarea
                            id={`task-context-${step.id}`}
                            value={step.context}
                            onFocus={() => selectStep(step.id)}
                            onChange={(event) => updateStep(step.id, "context", event.target.value)}
                            rows={4}
                            placeholder="前段の観測結果、既知の制約、利用可能な資料を書く"
                          />
                          <span className="field-hint">何を知っているか / 何が必要か</span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {guide("organize")}
          <button className={`add-task-button${target("organize")}`} type="button" onClick={addStep}>
            <span className="add-symbol" aria-hidden="true">＋</span>
            <span><strong>分析タスクを追加</strong><small>順序と引き継ぎをあとから調整できます</small></span>
          </button>

          <p className="keyboard-note"><span aria-hidden="true">⌘</span> フォーカスしたカードは ↑ ↓ で順序を変更できます。各入力欄は自動保存されます。</p>
        </section>

        <aside className={`right-column${scoredEvaluation ? " is-scored" : ""}`} aria-label="計画の評価">
          {guide("feedback")}
          <div className="score-panel-header">
            <div>
              <p className="mono-label">03 / REVIEW</p>
              <h2>計画の評価</h2>
            </div>
            <span className="live-badge">MANUAL</span>
          </div>

          <div className={`score-summary score-${summaryTone}`} aria-live="polite" aria-atomic="true">
            <div className="score-label-row">
              <span>総合スコア</span>
              <span className="score-status">{scoreStatus}</span>
            </div>
            <div className="score-value">
              {displayedScore === null ? <strong>--</strong> : <strong>{displayedScore}</strong>}
              <span>/ 100</span>
            </div>
            <div className="score-track" aria-hidden="true">
              <span style={{ width: `${displayedScore === null ? 0 : Math.max(0, Math.min(displayedScore, 100))}%` }} />
            </div>
            <p className="score-caption">
              {!scoredEvaluation
                ? "採点ボタンを押すまで点数は表示されません。"
                : hasUnscoredChanges
                  ? "入力内容が変更されています。現在の計画は再採点してください。"
                  : displayedPassed
                    ? "安全な分析の骨格ができています。"
                    : "採点結果をもとに計画を改善できます。"}
            </p>
          </div>

          <div className="criteria-block">
            <div className="subsection-heading">
              <span className="mono-label">EVALUATION AXES</span>
              <span className="criteria-count">{evaluation.criteria.length} AXES</span>
            </div>
            <div className="criteria-list">
              {displayedCriteria.length === 0 ? (
                <p className="pending-evaluation">採点後に項目別評価を表示します。</p>
              ) : displayedCriteria.map((criterion) => {
                const criterionScore = Math.round(criterion.score);
                const criterionMax = Math.max(criterion.max, 1);
                const percent = Math.max(0, Math.min(100, (criterionScore / criterionMax) * 100));
                return (
                  <div className="criterion" key={criterion.label}>
                    <div className="criterion-heading">
                      <span>{criterion.label}</span>
                      <strong>{criterionScore}<small>/{criterion.max}</small></strong>
                    </div>
                    <div className="criterion-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
                    <p>{criterion.message}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="feedback-block">
            <div className="subsection-heading">
              <span className="mono-label">NEXT ITERATION</span>
              <span className="feedback-mark" aria-hidden="true">↗</span>
            </div>
            <ul className="feedback-list">
              {!scoredEvaluation ? (
                <li><span aria-hidden="true">＋</span>採点後に改善提案を表示します。</li>
              ) : scoredEvaluation.improvements.length > 0 ? scoredEvaluation.improvements.slice(0, 3).map((improvement) => (
                <li key={improvement}><span aria-hidden="true">＋</span>{improvement}</li>
              )) : <li><span aria-hidden="true">✓</span>今の計画に大きな改善点はありません。</li>}
            </ul>
            {scoredEvaluation && scoredEvaluation.strengths.length > 0 && (
              <p className="strength-note"><span aria-hidden="true">✳</span>{scoredEvaluation.strengths[0]}</p>
            )}
          </div>

          <div className="score-actions">
            {guide("score")}
            <button className={`button button-score${target("score")}`} type="button" onClick={scorePlan}>
              <span>この計画を採点</span><span aria-hidden="true">→</span>
            </button>
            {guide("finish")}
            <button
              className={`button button-complete${completionState === "complete" ? " is-complete" : ""}`}
              type="button"
              onClick={completeLearning}
            >
              <span>{completionState === "complete" ? "学習を完了しました" : "学習を完了"}</span>
              <span aria-hidden="true">{completionState === "complete" ? "✓" : "↗"}</span>
            </button>
            {completionState === "needs-work" && (
              <p className="completion-note" role="status">
                {!scoredEvaluation || hasUnscoredChanges
                  ? "現在の計画を採点してから完了判定を行います。"
                  : "合格点は80点です。右の提案から計画を改善しましょう。"}
              </p>
            )}
          </div>
          <p className="live-region" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</p>
          <p className="right-footnote">評価は入力内容からローカルに算出されます。<br />実行結果や外部通信は扱いません。</p>
        </aside>
      </div>

      <footer className="app-footer">
        <span>PromptScope / ANALYSIS INSTRUCTION TRAINER</span>
        <span>v0.1 · LOCAL EDUCATIONAL PROTOTYPE</span>
      </footer>
    </main>
  );
}

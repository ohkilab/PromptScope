"use client";

import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import * as Progress from "@radix-ui/react-progress";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { AnalysisStep, EvaluationResult } from "./lib/evaluator";
import type { Scenario, ScenarioId } from "./lib/curriculum";
import { SCENARIOS } from "./lib/curriculum";
import { TUTORIAL_ANSWER, TUTORIAL_INPUT, TUTORIAL_SCENARIO, TUTORIAL_STEPS } from "./lib/tutorial";
import type { TutorialStepId } from "./lib/tutorial";
import { TutorialCoach, Welcome } from "./components/tutorial";
import { ExerciseEditor } from "./components/exercise-editor";
import { EvaluationProfileDetails } from "./components/evaluation-profile";
import { createCustomScenario, type CustomExerciseInput, type CustomScenario } from "./lib/exercises";
import { loadCustomExercises, MAX_CUSTOM_EXERCISES, saveCustomExercises } from "./lib/exercise-storage";

type PlanEvaluation = EvaluationResult;

type ScenarioRecord = Omit<Scenario, "id"> & {
  id: ScenarioId | "tutorial";
};

type DraftStep = {
  id: string;
  title: string;
  instruction: string;
  context: string;
};

type CompletionState = "idle" | "needs-work" | "complete";

type ScenarioDraftState = {
  revision: number;
  steps: DraftStep[];
  selectedStepId: string;
  scoredEvaluation: PlanEvaluation | null;
  hasUnscoredChanges: boolean;
  completionState: CompletionState;
};

const EMPTY_STEPS: DraftStep[] = [];
const EVALUATION_AXIS_COUNT = 5;

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

function planFingerprint(steps: DraftStep[]) {
  return JSON.stringify(steps.map((step) => ({
    title: step.title.replace(/\s+/g, " ").trim(),
    instruction: step.instruction.replace(/\s+/g, " ").trim(),
    context: step.context.replace(/\s+/g, " ").trim(),
  })));
}

function createScenarioDraft(scenario: ScenarioRecord): ScenarioDraftState {
  const steps = scenarioInitialSteps(scenario);
  return {
    revision: 0,
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
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState("");
  const [customScenarios, setCustomScenarios] = useState<CustomScenario[]>([]);
  const [editingScenario, setEditingScenario] = useState<CustomScenario | null | undefined>(undefined);
  const [storageReady, setStorageReady] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const scenarioList = [...SCENARIOS, ...customScenarios];
  const workspaceTitle = useRef<HTMLHeadingElement>(null);
  const isTutorial = view === "tutorial";
  const tutorialStep = TUTORIAL_STEPS[tutorialIndex].id;

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
      nextDisabled={id === "score" && (!scoredEvaluation || hasUnscoredChanges || isEvaluating)}
      onSkip={id === "score" ? () => {
        setTutorialIndex((current) => current + 1);
        setLiveMessage("LLM採点をスキップしました．採点環境が準備できたら，通常の演習で試せます．");
      } : undefined}
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

  useEffect(() => {
    if (view === "exercise" && editingScenario === undefined) {
      workspaceTitle.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [view, scenarioId, editingScenario]);

  useEffect(() => {
    try {
      const saved = loadCustomExercises(window.localStorage);
      // Browser data becomes available only after server hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomScenarios(saved.scenarios);
      setDraftsByScenario((current) => ({ ...current, ...Object.fromEntries(saved.scenarios.map((scenario) => {
        const restored = createScenarioDraft(scenario);
        restored.steps = saved.stepsByScenario[scenario.id];
        restored.selectedStepId = restored.steps[0]?.id ?? "";
        return [scenario.id, restored];
      })) }));
      setStorageReady(true);
    } catch {
      setStorageMessage("保存済みの問題を読み込めませんでした。このページでは自作問題を一時的に利用できますが、ブラウザーには保存できません。");
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      saveCustomExercises(window.localStorage, customScenarios, Object.fromEntries(customScenarios.map((scenario) => [scenario.id, draftsByScenario[scenario.id]?.steps ?? scenario.initialSteps])));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageMessage("");
    } catch {
      setStorageMessage("ブラウザーへの保存に失敗しました。自作問題と回答はこのページを開いている間だけ保持されます。");
    }
  }, [storageReady, customScenarios, draftsByScenario]);

  const activeDraft = activeScenario
    ? activeScenario.id === "tutorial" ? tutorialDraft : draftsByScenario[activeScenario.id] ?? createScenarioDraft(activeScenario)
    : null;
  const steps = activeDraft?.steps ?? EMPTY_STEPS;
  const selectedStepId = activeDraft?.selectedStepId ?? "";
  const scoredEvaluation = activeDraft?.scoredEvaluation ?? null;
  const hasUnscoredChanges = activeDraft?.hasUnscoredChanges ?? false;
  const completionState = activeDraft?.completionState ?? "idle";

  if (view === "welcome") {
    return <Welcome onTutorial={startTutorial} onExercise={openExercise} />;
  }

  if (!activeScenario) {
    return (
      <main className="empty-app">
        <p className="mono-label">PromptScope</p>
        <h1>演習を読み込めませんでした。</h1>
      </main>
    );
  }

  const displayedScore = scoredEvaluation ? Math.round(scoredEvaluation.total) : null;
  const displayedCriteria = scoredEvaluation?.criteria ?? [];
  const displayedPassed = scoredEvaluation?.passed ?? false;
  const displayedFeedback = scoredEvaluation
    ? scoredEvaluation.improvements.slice(0, 3)
    : [];
  const scoreStatus = isEvaluating
    ? "LLMで採点中"
    : !scoredEvaluation
    ? "未採点"
    : hasUnscoredChanges
      ? "前回採点 / 再採点待ち"
      : displayedPassed
        ? "目標達成"
        : "改善中";
  const summaryTone = displayedScore === null
    ? "unscored"
    : scoreTone(displayedPassed ? displayedScore : Math.min(displayedScore, 79));
  const evaluationSource = scoredEvaluation?.provider === "openrouter"
    ? "OPENROUTER"
    : scoredEvaluation?.provider === "ollama"
      ? "OLLAMA"
      : "LLM";

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
      if (activeId.startsWith("custom-") && !current[activeId]) return current;
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
    setEvaluationError("");
    updateActiveDraft((current) => ({
      ...current,
      revision: current.revision + 1,
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

  function switchScenario(nextScenario: Scenario) {
    setEvaluationError("");
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

  function saveExercise(input: CustomExerciseInput) {
    if (!editingScenario && customScenarios.length >= MAX_CUSTOM_EXERCISES) {
      throw new Error(`自作問題は${MAX_CUSTOM_EXERCISES}件まで保存できます。既存の問題を編集・削除してください。`);
    }
    const id = editingScenario?.id ?? `custom-${crypto.randomUUID()}`;
    const scenario = createCustomScenario(input, id);
    setCustomScenarios((current) => editingScenario ? current.map((item) => item.id === id ? scenario : item) : [...current, scenario]);
    setDraftsByScenario((current) => ({ ...current, [id]: current[id] ? {
      ...current[id], revision: current[id].revision + 1, scoredEvaluation: null, hasUnscoredChanges: true, completionState: "idle",
    } : createScenarioDraft(scenario) }));
    setScenarioId(id);
    setEvaluationError("");
    setEditingScenario(undefined);
    setLiveMessage("問題を保存しました。目的と資料を読み、分析タスクを自分で組み立ててください。");
  }

  function deleteExercise() {
    if (!editingScenario) return;
    const id = editingScenario.id;
    setCustomScenarios((current) => current.filter((scenario) => scenario.id !== id));
    setDraftsByScenario((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (scenarioId === id) setScenarioId(firstScenario.id);
    setEditingScenario(undefined);
    setEvaluationError("");
    setLiveMessage("自作問題と回答を削除しました。");
  }

  function addStep() {
    if (steps.length >= 20) {
      setLiveMessage("分析タスクは20件までです。既存のタスクを整理してください。");
      return;
    }
    const nextId = `step-${crypto.randomUUID()}`;
    const nextStep: DraftStep = {
      id: nextId,
      title: "",
      instruction: "",
      context: "",
    };
    setEvaluationError("");
    updateActiveDraft((current) => ({
      ...current,
      revision: current.revision + 1,
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
    setEvaluationError("");
    updateActiveDraft((current) => {
      const replacement = nextSteps[Math.min(removedIndex, nextSteps.length - 1)];
      return {
        ...current,
        revision: current.revision + 1,
        steps: nextSteps,
        selectedStepId: stepId === selectedStepId ? replacement?.id ?? "" : current.selectedStepId,
        hasUnscoredChanges: true,
        completionState: "idle",
      };
    });
    setLiveMessage("分析タスクを削除しました。");
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setEvaluationError("");
    updateActiveDraft((current) => {
      const index = current.steps.findIndex((step) => step.id === stepId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.steps.length) return current;
      const next = [...current.steps];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return {
        ...current,
        revision: current.revision + 1,
        steps: next,
        selectedStepId: stepId,
        hasUnscoredChanges: true,
        completionState: "idle",
      };
    });
  }

  async function scorePlan() {
    if (isEvaluating) return;

    const submittedFingerprint = planFingerprint(steps);
    const submittedRevision = activeDraft?.revision ?? 0;
    const initialFingerprint = planFingerprint(scenarioInitialSteps(activeScenario));
    if (!isTutorial && submittedFingerprint === initialFingerprint) {
      const message = "初期案のままでは採点できません。少なくとも1か所を自分の判断で編集してください。";
      setEvaluationError(message);
      setLiveMessage(message);
      return;
    }

    setIsEvaluating(true);
    setEvaluationError("");
    setLiveMessage("LLMが計画を採点しています。しばらくお待ちください。");

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: {
            title: activeScenario.title,
            description: activeScenario.description,
            goal: activeScenario.goal,
            environment: activeScenario.environment,
            materials: activeScenario.materials,
            evaluationProfile: activeScenario.evaluationProfile,
          },
          steps: toAnalysisSteps(steps),
        }),
      });
      const payload = await response.json() as PlanEvaluation | { error?: string };
      if (!response.ok || !("criteria" in payload)) {
        throw new Error("error" in payload && payload.error
          ? payload.error
          : "採点結果を取得できませんでした。");
      }

      const nextScore = Math.round(payload.total);
      const nextPassed = payload.passed;
      updateActiveDraft((current) => ({
        ...current,
        scoredEvaluation: payload,
        hasUnscoredChanges: current.revision !== submittedRevision || planFingerprint(current.steps) !== submittedFingerprint,
        completionState: "idle",
      }));
      setLiveMessage(
        `計画を採点しました。総合スコアは ${nextScore} 点です。${nextPassed ? "合格条件を満たしています。" : nextScore < 80 ? "80点まで改善の余地があります。" : "タスク別の合格条件を確認してください。"}`,
      );
      if (isTutorial && tutorialStep === "score") setTutorialIndex((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "採点に失敗しました。";
      setEvaluationError(message);
      setLiveMessage(message);
    } finally {
      setIsEvaluating(false);
    }
  }

  function completeLearning() {
    if (isEvaluating || !scoredEvaluation || hasUnscoredChanges || displayedScore === null) {
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
      setLiveMessage(displayedScore < 80
        ? `まだ学習途中です。合格点の80点まで、${80 - displayedScore}点分の改善を試してみましょう。`
        : scoredEvaluation.gateFailures[0] ?? "タスク別の合格条件を確認してください。",
      );
    }
  }

  function keepTutorialFocusInSpotlight(event: FocusEvent<HTMLElement>) {
    if (!isTutorial || !(event.target instanceof HTMLElement)) return;
    if (event.target.closest(".tutorial-target, .tutorial-coach, .learning-toolbar")) return;

    event.preventDefault();
    event.stopPropagation();
    document.querySelector<HTMLElement>(".tutorial-coach h3")?.focus({ preventScroll: true });
  }

  return (
    <main
      className={`app-shell${isTutorial ? " tutorial-shell" : ""}`}
      onFocusCapture={keepTutorialFocusInSpotlight}
    >
      <header className="topbar">
        <div className="brand-lockup" aria-label="PromptScope">
          <span className="brand-name">PromptScope</span>
          <span className="brand-tagline">安全な分析は、よい分解から。</span>
        </div>
        <div className="topbar-meta">
          <span className="local-indicator" aria-hidden="true" />
          <span>学習モード</span>
          <span className="slash" aria-hidden="true">/</span>
          <span className="mono-label">LLMによる採点支援</span>
        </div>
      </header>

      <div className="learning-toolbar">
        {isTutorial ? <>
          <div><span className="mono-label accent-label">例題ガイド</span><strong>専用の例題で練習中</strong><span>{tutorialIndex + 1} / {TUTORIAL_STEPS.length}</span></div>
          <button className="button button-complete" type="button" onClick={openExercise}>ガイドを終了して演習へ</button>
        </> : <>
          <span>目的を読み，タスクと指示を組み立てましょう．</span>
          <button className="button button-complete" type="button" onClick={startTutorial}>使い方・例題を見る</button>
        </>}
      </div>

      <div className="workspace-grid">
        <aside className="left-column" aria-label="演習選択と学習の焦点">
          <div className="column-intro">
            <p className="mono-label">演習</p>
            <h2>{isTutorial ? "使い方を学ぶ" : "演習を選ぶ"}</h2>
            <p className="column-description">{isTutorial ? "例題の編集や採点は演習に影響しません．途中でもガイドを終了できます．" : "危険な処理を実行せず、分解の仕方だけを練習します。"}</p>
          </div>

          {isTutorial ? <ol className="tutorial-outline" aria-label="使い方ガイドの流れ">
            {TUTORIAL_STEPS.map((step, index) => <li key={step.id} aria-current={index === tutorialIndex ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{step.title}</li>)}
          </ol> : <nav className="scenario-nav" aria-label="演習一覧">
            {scenarioList.map((scenario) => {
              const isActive = scenario.id === activeScenario.id;
              return (
                <button
                  className={`scenario-item${isActive ? " is-active" : ""}`}
                  key={String(scenario.id)}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => switchScenario(scenario)}
                >
                  <span className="scenario-copy">
                    <span className="scenario-eyebrow">{scenario.eyebrow}</span>
                    <span className="scenario-title">{scenario.title}</span>
                  </span>
                  <span className="scenario-arrow" aria-hidden="true">↗</span>
                </button>
              );
            })}
          </nav>}

          {!isTutorial && <div className="custom-exercise-actions">
            <button className="button button-secondary" type="button" onClick={() => setEditingScenario(null)} disabled={customScenarios.length >= MAX_CUSTOM_EXERCISES}>＋ 自分の問題を作る</button>
            <p>自作問題と回答はこのブラウザーに保存します（最大{MAX_CUSTOM_EXERCISES}件）。</p>
          </div>}
          {!isTutorial && storageMessage && <p className="storage-message" role="alert">{storageMessage}</p>}

          <section className="focus-note" aria-labelledby="focus-heading">
            <div className="focus-heading-row">
              <p className="mono-label">学習の要点</p>
            </div>
            <h2 id="focus-heading">学習の焦点</h2>
            <ul className="focus-list">
              <li><p>目的と完了条件を先に置く</p></li>
              <li><p>観測と判断を別のタスクに分ける</p></li>
              <li><p>権限・入力・出力の境界を明記する</p></li>
            </ul>
          </section>

          <div className="left-footer">
            <span className="safety-stamp">実処理なし</span>
            <p>教育用プロトタイプ<br />実処理は行いません・採点と評価観点の提案時にLLMと通信</p>
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
              {activeScenario.id.startsWith("custom-") ? <button className="button button-complete" type="button" onClick={() => setEditingScenario(customScenarios.find(({ id }) => id === activeScenario.id))}>問題・評価観点を編集</button> : <span className="scenario-count">{String(activeScenario.id).toUpperCase()}</span>}
            </div>
            <p className="overview-description">{activeScenario.description}</p>
            <div className="overview-meta" aria-label="演習の概要">
              <div className="meta-block">
                <span className="mono-label">目標</span>
                <strong>{activeScenario.goal}</strong>
              </div>
              <div className="meta-block">
                <span className="mono-label">演習環境</span>
                <strong>{activeScenario.environment}</strong>
              </div>
              <div className="meta-block meta-risk">
                <span className="mono-label">リスク・所要時間</span>
                <strong><span>{activeScenario.riskLabel}</span><span className="meta-separator">·</span>{activeScenario.duration}</strong>
              </div>
            </div>
            {activeScenario.materials && <details className="exercise-materials" open><summary>入力データ・配布資料</summary><pre>{activeScenario.materials}</pre></details>}
            {activeScenario.evaluationProfile && <EvaluationProfileDetails profile={activeScenario.evaluationProfile} />}
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
                <p className="mono-label">タスクの分解</p>
                <h2>分解の進捗</h2>
              </div>
              <span className="progress-count">{steps.length}件のタスク</span>
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
              <p className="mono-label">タスク計画</p>
              <h2>分析タスク</h2>
            </div>
            <p className="helper-copy">安全な順序と、Agentに渡す境界を設計します。</p>
          </div>

          <Tooltip.Provider delayDuration={450} skipDelayDuration={200}>
          <div className="task-list" aria-label="編集可能な分析タスク">
            {steps.length === 0 ? (
              <div className="empty-tasks">
                <p className="mono-label">タスクはまだありません</p>
                <p>最初の分析タスクを追加して計画を始めましょう。</p>
                <button className="button button-secondary" type="button" onClick={addStep} disabled={steps.length >= 20}>＋ タスクを追加</button>
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
                        {[
                          { label: "タスクを上へ移動", symbol: "↑", disabled: index === 0, action: () => moveStep(step.id, -1), danger: false },
                          { label: "タスクを下へ移動", symbol: "↓", disabled: index === steps.length - 1, action: () => moveStep(step.id, 1), danger: false },
                          { label: "タスクを削除", symbol: "×", disabled: false, action: () => removeStep(step.id), danger: true },
                        ].map((action) => (
                          <Tooltip.Root key={action.label}>
                            <Tooltip.Trigger asChild>
                              <button
                                className={`icon-button${action.danger ? " icon-button-danger" : ""}`}
                                type="button"
                                aria-label={action.label}
                                disabled={action.disabled}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  action.action();
                                }}
                              >{action.symbol}</button>
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content className="action-tooltip" side="top" sideOffset={6}>
                                {action.label}
                                <Tooltip.Arrow className="action-tooltip-arrow" />
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        ))}
                      </div>
                    </div>

                    <div className="task-card-body">
                      <div className="field field-title">
                        <label htmlFor={`task-title-${step.id}`}>タスクタイトル</label>
                        <input
                          id={`task-title-${step.id}`}
                          maxLength={240}
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
                            maxLength={4_000}
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
                            maxLength={4_000}
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
          </Tooltip.Provider>

          {guide("organize")}
          <button className={`add-task-button${target("organize")}`} type="button" onClick={addStep} disabled={steps.length >= 20}>
            <span className="add-symbol" aria-hidden="true">＋</span>
            <span><strong>分析タスクを追加</strong><small>順序と引き継ぎをあとから調整できます</small></span>
          </button>

          <p className="keyboard-note"><span aria-hidden="true">⌘</span> フォーカスしたカードは ↑ ↓ で順序を変更できます。各入力欄は自動保存されます。</p>
        </section>

        <aside className={`right-column${scoredEvaluation ? " is-scored" : ""}${target("feedback")}`} aria-label="計画の評価">
          {guide("feedback")}
          <div className="score-panel-header">
            <div>
              <p className="mono-label">振り返り</p>
              <h2>計画の評価</h2>
            </div>
            <span className="live-badge">{evaluationSource}</span>
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
            <Progress.Root
              className="score-track"
              value={displayedScore ?? 0}
              max={100}
              aria-label={displayedScore === null ? "総合スコアは未採点です" : `総合スコア ${displayedScore}点`}
            >
              <Progress.Indicator className="score-track-indicator" style={{ width: `${displayedScore === null ? 0 : Math.max(0, Math.min(displayedScore, 100))}%` }} />
            </Progress.Root>
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
              <span className="mono-label">評価項目</span>
              <span className="criteria-count">{EVALUATION_AXIS_COUNT}項目</span>
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
                    <Progress.Root
                      className="criterion-track"
                      value={criterionScore}
                      max={criterionMax}
                      aria-label={`${criterion.label} ${criterionScore}/${criterion.max}点`}
                    ><Progress.Indicator className="criterion-track-indicator" style={{ width: `${percent}%` }} /></Progress.Root>
                    <p>{criterion.message}</p>
                    {criterion.findings && criterion.findings.length > 0 && (
                      <ul className="criterion-findings">
                        {criterion.findings.map((finding) => (
                          <li key={`${criterion.id}-${finding.code}-${finding.evidence}`}>
                            <div className="criterion-finding-heading">
                              <strong>{finding.label}</strong>
                              <span>−{finding.points}点</span>
                            </div>
                            {finding.stepReferences.length > 0 && (
                              <p className="criterion-finding-location">{finding.stepReferences.join("・")}</p>
                            )}
                            <p className="criterion-finding-evidence">該当箇所「{finding.evidence}」</p>
                            <p>{finding.guidance}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {criterion.stepDetails && criterion.stepDetails.length > 0 && (
                      <Accordion.Root className="step-evaluation" type="single" collapsible>
                        <Accordion.Item value="details">
                          <Accordion.Header className="step-evaluation-header">
                            <Accordion.Trigger className="step-evaluation-trigger">
                              <span>タスク別内訳</span>
                              <span className="step-evaluation-meta"><small>{criterion.stepDetails.length}件</small><span className="step-evaluation-chevron" aria-hidden="true">⌄</span></span>
                            </Accordion.Trigger>
                          </Accordion.Header>
                          <Accordion.Content className="step-evaluation-content">
                            <ol>
                          {criterion.stepDetails.map((detail) => (
                            <li key={`${criterion.id}-${detail.stepId}-${detail.stepNumber}`}>
                              <div className="step-evaluation-heading">
                                <span className="step-evaluation-index">
                                  {String(detail.stepNumber).padStart(2, "0")}
                                </span>
                                <span className="step-evaluation-title">{detail.title}</span>
                                <strong>{Math.round(detail.score)}<small>/{detail.max}</small></strong>
                              </div>
                              <p>{detail.message}</p>
                            </li>
                          ))}
                            </ol>
                          </Accordion.Content>
                        </Accordion.Item>
                      </Accordion.Root>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="feedback-block">
            <div className="subsection-heading">
              <span className="mono-label">次の改善点</span>
              <span className="feedback-mark" aria-hidden="true">↗</span>
            </div>
            <ul className="feedback-list">
              {!scoredEvaluation ? (
                <li><span aria-hidden="true">・</span>採点後に改善提案を表示します。</li>
              ) : displayedFeedback.length > 0 ? displayedFeedback.map((improvement) => (
                <li key={improvement}>
                  <span aria-hidden="true">・</span>
                  <span className="feedback-message">{improvement}</span>
                </li>
              )) : <li><span aria-hidden="true">✓</span>今の計画に大きな改善点はありません。</li>}
            </ul>
            {scoredEvaluation && scoredEvaluation.strengths.length > 0 && (
              <p className="strength-note">{scoredEvaluation.strengths[0]}</p>
            )}
          </div>

          <div className="score-actions">
            {guide("score")}
            <button
              className={`button button-score${target("score")}`}
              type="button"
              onClick={scorePlan}
              disabled={isEvaluating}
              aria-busy={isEvaluating}
            >
              <span>{isEvaluating ? "LLMで採点中..." : "この計画を採点"}</span>
              <span aria-hidden="true">{isEvaluating ? "…" : "→"}</span>
            </button>
            {evaluationError && <p className="evaluation-error" role="alert">{evaluationError}</p>}
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
                  : scoredEvaluation.gateFailures[0] ?? "右の提案から計画を改善しましょう。"}
              </p>
            )}
          </div>
          <p className="live-region" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</p>
          <p className="right-footnote">
            {scoredEvaluation
              ? `採点: ${evaluationSource} / ${scoredEvaluation.model}`
              : "評価時に入力内容を設定済みのLLMへ送信します。"}
            <br />評価は教育上の助言であり、実環境の安全性を保証しません。
          </p>
        </aside>
      </div>

      <footer className="app-footer">
        <span>PromptScope / ANALYSIS INSTRUCTION TRAINER</span>
        <span>v0.2 · LLM-ASSISTED EDUCATIONAL PROTOTYPE</span>
      </footer>
      {!isTutorial && editingScenario !== undefined && <ExerciseEditor key={editingScenario?.id ?? "new"} scenario={editingScenario} onSave={saveExercise} onDelete={deleteExercise} onClose={() => setEditingScenario(undefined)} />}
    </main>
  );
}

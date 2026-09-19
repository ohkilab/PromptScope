"use client";

import { useEffect, useRef } from "react";
import { TUTORIAL_STEPS } from "../lib/tutorial";

export function Welcome({ onTutorial, onExercise }: { onTutorial: () => void; onExercise: () => void }) {
  return (
    <main className="app-shell welcome-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">PS</span><span className="brand-name">PromptScope</span></div>
        <span className="mono-label">ANALYSIS INSTRUCTION TRAINER</span>
      </header>
      <section className="welcome-content" aria-labelledby="welcome-title">
        <p className="mono-label accent-label">WELCOME / はじめての方へ</p>
        <h1 id="welcome-title">安全な分析は，<br />よい分解から．</h1>
        <p className="welcome-lead">AI に何を，どこまで任せるか．<br />分析の仕事を分けて，伝わる指示を練習しましょう．</p>
        <ol className="welcome-flow">
          <li><span className="mono-label">01 / READ</span><h2>目的を読む</h2><p>何を調べるのか，使える材料と制約を確認します．</p></li>
          <li><span className="mono-label">02 / WRITE</span><h2>仕事を分けて書く</h2><p>AI に任せるタスクと，指示・前提を組み立てます．</p></li>
          <li><span className="mono-label">03 / REVIEW</span><h2>採点して改善する</h2><p>5つの評価軸と改善提案を読み，計画を磨きます．</p></li>
        </ol>
        <div className="welcome-start">
          <div><span className="mono-label accent-label">GUIDED EXAMPLE / 約3分</span><h2>まずは小さな例題から</h2><p>架空のファイル一覧を使い，吹き出しの案内に沿って入力と採点を体験できます．</p></div>
          <button className="button button-score" type="button" onClick={onTutorial}>例題で使い方を学ぶ <span aria-hidden="true">→</span></button>
        </div>
        <button className="button button-complete welcome-skip" type="button" onClick={onExercise}>使い方をスキップして演習を始める <span aria-hidden="true">↗</span></button>
        <p className="welcome-footnote">教育用の練習ツールです．入力は外部送信されず，実処理や AI の実行は行いません．<br />回答はこのページを開いている間だけ保持されます．</p>
      </section>
    </main>
  );
}

export function TutorialCoach({ index, onBack, onNext, onExample, nextDisabled }: {
  index: number;
  onBack: () => void;
  onNext: () => void;
  onExample?: () => void;
  nextDisabled: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const step = TUTORIAL_STEPS[index];

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest(".tutorial-coach")?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [index]);

  return (
    <section className="tutorial-coach" aria-labelledby={`guide-${step.id}`}>
      <p className="mono-label">使い方ガイド / {index + 1} OF {TUTORIAL_STEPS.length}</p>
      <h3 id={`guide-${step.id}`} ref={heading} tabIndex={-1}>{step.title}</h3>
      <p>{step.description}</p>
      {onExample && <button className="button tutorial-example" type="button" onClick={onExample}>回答例を入力</button>}
      <div className="tutorial-coach-actions">
        <button className="button button-complete" type="button" onClick={onBack} disabled={index === 0}>戻る</button>
        <button className="button button-score" type="button" onClick={onNext} disabled={nextDisabled}>
          {index === TUTORIAL_STEPS.length - 1 ? "チュートリアルを完了" : nextDisabled ? "採点して次へ" : "次へ →"}
        </button>
      </div>
    </section>
  );
}

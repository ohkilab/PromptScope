import type { AnalysisStep } from "./evaluator";
import { createCustomScenario, type CustomScenario } from "./exercises";

const STORAGE_KEY = "promptscope.custom-exercises.v1";
export const MAX_CUSTOM_EXERCISES = 20;

type SavedExercises = {
  scenarios: CustomScenario[];
  stepsByScenario: Record<string, AnalysisStep[]>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSteps(value: unknown): AnalysisStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error("保存された回答の形式が不正です。");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!record(item)) throw new Error("保存されたタスクの形式が不正です。");
    for (const [key, limit] of [["id", 160], ["title", 240], ["instruction", 4_000], ["context", 4_000]] as const) {
      if (typeof item[key] !== "string" || item[key].length > limit) throw new Error("保存されたタスクの入力が不正です。");
    }
    const step = { id: item.id as string, title: item.title as string, instruction: item.instruction as string, context: item.context as string };
    if (!step.id.trim() || ids.has(step.id)) throw new Error("保存されたタスクのIDが不正です。");
    ids.add(step.id);
    return step;
  });
}

export function loadCustomExercises(storage: Storage): SavedExercises {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { scenarios: [], stepsByScenario: {} };
  const saved: unknown = JSON.parse(raw);
  if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.exercises) || saved.exercises.length > MAX_CUSTOM_EXERCISES) {
    throw new Error("保存された問題の形式が不正です。");
  }
  const scenarios: CustomScenario[] = [];
  const stepsByScenario: Record<string, AnalysisStep[]> = {};
  for (const entry of saved.exercises) {
    if (!record(entry) || typeof entry.id !== "string" || !entry.id.startsWith("custom-") || scenarios.some(({ id }) => id === entry.id)) {
      throw new Error("保存された問題のIDが不正です。");
    }
    const scenario = createCustomScenario(entry.input, entry.id as `custom-${string}`);
    scenarios.push(scenario);
    stepsByScenario[scenario.id] = parseSteps(entry.steps);
  }
  return { scenarios, stepsByScenario };
}

export function saveCustomExercises(storage: Storage, scenarios: CustomScenario[], stepsByScenario: Record<string, AnalysisStep[]>) {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    exercises: scenarios.map((scenario) => ({
      id: scenario.id,
      input: {
        title: scenario.title, description: scenario.description, goal: scenario.goal,
        environment: scenario.environment, materials: scenario.materials, evaluationProfile: scenario.evaluationProfile,
      },
      steps: stepsByScenario[scenario.id] ?? scenario.initialSteps,
    })),
  }));
}

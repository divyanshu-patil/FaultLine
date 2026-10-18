import type { Budget } from "@faultline/schemas";

/** Defaults from docs/06 §8 (judgement). Caps are the schema maxima. */
export const DEFAULT_BUDGET: Budget = {
  maxSteps: 20,
  maxAttacks: 8,
  maxPatchAttempts: 2,
  maxModelCalls: 40,
  maxSeconds: 900,
};

export type Usage = { steps: number; attacks: number; modelCalls: number; tokens: number; startedAt: number };

export function newUsage(now: number): Usage {
  return { steps: 0, attacks: 0, modelCalls: 0, tokens: 0, startedAt: now };
}

/** Name of the first exhausted budget, or null when there is room left. */
export function exhausted(budget: Budget, usage: Usage, now: number): string | null {
  if (usage.steps >= budget.maxSteps) return "steps";
  if (usage.attacks >= budget.maxAttacks) return "attacks";
  if (usage.modelCalls >= budget.maxModelCalls) return "model calls";
  if ((now - usage.startedAt) / 1000 >= budget.maxSeconds) return "wall clock";
  return null;
}

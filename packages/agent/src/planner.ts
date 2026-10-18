import { PlannerAction, type AttackId, type AttackSpec } from "@faultline/schemas";
import { type Ollama, extractJsonObject } from "./ollama.ts";
import { PREAMBLE, plannerPrompt } from "./prompts.ts";

export type OpenFinding = { id: string; attackId: string; failed: string[]; diagnosed: boolean; patch: string };

/** The worker supplies these; the planner only decides which to call. All deterministic except where noted. */
export type PlannerTools = {
  runAttack(attackId: AttackId, reason: string): Promise<{ summary: string; findings: OpenFinding[] }>;
  readSource(file: string, from?: number, to?: number): Promise<string>;
  inspectEvidence(ids: string[]): Promise<string>;
  diagnoseFinding(findingId: string): Promise<string>;
  proposeAndVerifyPatch(findingId: string): Promise<string>;
};

export type PlannerState = {
  suspects: { q: string; likely_bug: boolean; confidence: number; attack: string }[];
  attacks: AttackSpec[];
  allowed: Set<AttackId>;
  budget: { steps: number; attacks: number; patchAttempts: number; secondsLeft: () => number };
};

export type PlannerEvent =
  | { kind: "step"; tool: string; args: unknown; why: string | null; valid: boolean; error?: string; result?: string }
  | { kind: "degraded"; reason: string }
  | { kind: "stopped"; reason: string };

const TEMPERATURE = 0.2;

/**
 * Planner loop (F12). One tool call per step; code — not the prompt — enforces the allowlist, the ≤2-per-attack
 * cap, diagnose-before-patch, budgets, and degradation after 3 invalid replies (docs/06 §3-5, §9).
 */
export async function runPlanner(ollama: Ollama, state: PlannerState, tools: PlannerTools, emit: (e: PlannerEvent) => void): Promise<{ attacksRun: AttackId[]; degraded: boolean }> {
  const history: string[] = [];
  const openFindings = new Map<string, OpenFinding>();
  const attackCount = new Map<AttackId, number>();
  const patchAttempts = new Map<string, number>();
  let steps = 0;
  let attacksUsed = 0;
  let invalidStreak = 0;

  const budgetLeft = () => ({
    steps: state.budget.steps - steps,
    attacks: state.budget.attacks - attacksUsed,
    patchAttempts: state.budget.patchAttempts,
    seconds: Math.max(0, Math.round(state.budget.secondsLeft())),
  });

  while (steps < state.budget.steps && state.budget.secondsLeft() > 0) {
    const prompt = plannerPrompt({ budget: budgetLeft(), suspects: state.suspects, attacks: state.attacks, history, findings: [...openFindings.values()] });
    let res;
    try {
      res = await ollama.chat("planner", [
        { role: "system", content: PREAMBLE },
        { role: "user", content: prompt },
      ], undefined, { temperature: TEMPERATURE });
    } catch {
      emit({ kind: "degraded", reason: "model call failed" });
      return { attacksRun: [...attackCount.keys()], degraded: true };
    }

    const action = parseAction(res.content);
    steps++;
    if (!action.ok) {
      invalidStreak++;
      emit({ kind: "step", tool: "?", args: res.content.slice(0, 200), why: null, valid: false, error: action.error });
      if (invalidStreak >= 3) {
        emit({ kind: "degraded", reason: "3 consecutive invalid planner outputs" });
        return { attacksRun: [...attackCount.keys()], degraded: true };
      }
      continue;
    }
    invalidStreak = 0;
    const why = ("reason" in action.value.args && typeof action.value.args.reason === "string" ? action.value.args.reason : null) as string | null;

    const guard = checkRules(action.value, state.allowed, attackCount, openFindings, patchAttempts, state.budget.patchAttempts);
    if (guard) {
      emit({ kind: "step", tool: action.value.tool, args: action.value.args, why, valid: false, error: guard });
      history.push(`step ${steps}: ${action.value.tool} rejected (${guard})`);
      continue;
    }

    if (action.value.tool === "finish") {
      emit({ kind: "step", tool: "finish", args: action.value.args, why, valid: true, result: "done" });
      return { attacksRun: [...attackCount.keys()], degraded: false };
    }

    const result = await execute(action.value, tools, openFindings, attackCount, patchAttempts);
    if (action.value.tool === "run_attack") attacksUsed++;
    emit({ kind: "step", tool: action.value.tool, args: action.value.args, why, valid: true, result });
    history.push(`step ${steps}: ${action.value.tool} ${JSON.stringify(action.value.args).slice(0, 80)} → ${result.slice(0, 120)}`);

    if (attacksUsed >= state.budget.attacks) {
      emit({ kind: "stopped", reason: "attack budget spent" });
      break;
    }
  }
  emit({ kind: "stopped", reason: steps >= state.budget.steps ? "step budget spent" : "time budget spent" });
  return { attacksRun: [...attackCount.keys()], degraded: false };
}

function parseAction(content: string): { ok: true; value: PlannerAction } | { ok: false; error: string } {
  try {
    const parsed = PlannerAction.safeParse(extractJsonObject(content));
    if (parsed.success) return { ok: true, value: parsed.data };
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Returns a rejection reason, or null when the action is allowed. */
function checkRules(
  action: PlannerAction,
  allowed: Set<AttackId>,
  attackCount: Map<AttackId, number>,
  openFindings: Map<string, OpenFinding>,
  patchAttempts: Map<string, number>,
  maxPatchAttempts: number,
): string | null {
  if (action.tool === "run_attack") {
    if (!allowed.has(action.args.attack_id)) return `attack ${action.args.attack_id} is not in the allowed set`;
    if ((attackCount.get(action.args.attack_id) ?? 0) >= 2) return `attack ${action.args.attack_id} already run twice`;
  }
  if (action.tool === "diagnose_finding" && !openFindings.has(action.args.finding_id)) return `no open finding ${action.args.finding_id}`;
  if (action.tool === "propose_and_verify_patch") {
    const f = openFindings.get(action.args.finding_id);
    if (!f) return `no open finding ${action.args.finding_id}`;
    if (!f.diagnosed) return `finding ${action.args.finding_id} must be diagnosed before patching`;
    if ((patchAttempts.get(action.args.finding_id) ?? 0) >= maxPatchAttempts) return `patch attempts exhausted for ${action.args.finding_id}`;
  }
  return null;
}

async function execute(
  action: PlannerAction,
  tools: PlannerTools,
  openFindings: Map<string, OpenFinding>,
  attackCount: Map<AttackId, number>,
  patchAttempts: Map<string, number>,
): Promise<string> {
  switch (action.tool) {
    case "run_attack": {
      attackCount.set(action.args.attack_id, (attackCount.get(action.args.attack_id) ?? 0) + 1);
      const { summary, findings } = await tools.runAttack(action.args.attack_id, action.args.reason);
      for (const f of findings) openFindings.set(f.id, f);
      return summary;
    }
    case "read_source":
      return tools.readSource(action.args.file, action.args.from_line, action.args.to_line);
    case "inspect_evidence":
      return tools.inspectEvidence(action.args.ids);
    case "diagnose_finding": {
      const summary = await tools.diagnoseFinding(action.args.finding_id);
      const f = openFindings.get(action.args.finding_id);
      if (f) f.diagnosed = true;
      return summary;
    }
    case "propose_and_verify_patch": {
      patchAttempts.set(action.args.finding_id, (patchAttempts.get(action.args.finding_id) ?? 0) + 1);
      const summary = await tools.proposeAndVerifyPatch(action.args.finding_id);
      const f = openFindings.get(action.args.finding_id);
      if (f) f.patch = summary;
      return summary;
    }
    case "finish":
      return "done";
  }
}

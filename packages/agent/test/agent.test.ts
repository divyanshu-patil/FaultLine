import { describe, expect, it } from "vitest";
import { ATTACKS, MUST_ATTACKS } from "@faultline/core";
import type { AttackId, Verdict } from "@faultline/schemas";
import { createFakeOllama } from "@faultline/testing";
import { createOllama, diagnose, extractJsonObject, recon, runPlanner, type OpenFinding, type PlannerEvent } from "../src/index.ts";

const host = "https://ollama.test";
const mk = (responder: Parameters<typeof createFakeOllama>[0], healthy = true) =>
  createOllama({ host, apiKey: "k", model: "gemma4:31b", fetch: createFakeOllama(responder, { healthy }).fetch, retries: 0 });

describe("ollama client", () => {
  it("extracts a balanced JSON object from prose and fences", () => {
    expect(extractJsonObject('```json\n{"a":{"b":1}}\n```')).toEqual({ a: { b: 1 } });
    expect(extractJsonObject('blah {"tool":"finish","args":{"summary":"ok"}} trailing')).toMatchObject({ tool: "finish" });
    expect(() => extractJsonObject("no object")).toThrow();
  });

  it("reports health and logs each call", async () => {
    const logs: string[] = [];
    const client = createOllama({ host, apiKey: "k", model: "gemma4:31b", fetch: createFakeOllama(() => ({ content: "hi" })).fetch, onCall: (l) => logs.push(l.outcome) });
    expect(await client.health()).toBe(true);
    await client.chat("planner", [{ role: "user", content: "x" }], undefined);
    expect(logs).toEqual(["ok"]);
    const down = createOllama({ host, apiKey: "k", model: "gemma4:31b", fetch: createFakeOllama(() => ({ content: "" }), { healthy: false }).fetch });
    expect(await down.health()).toBe(false);
  });
});

describe("recon (T-AG-recon, AC-42/43)", () => {
  const excerpts = [{ srcId: "src-0001", file: "src/routes/webhooks.ts", text: "grant(req.body)" }];
  const suspectsJson = {
    suspects: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"].map((q) => ({ q, likely_bug: q === "Q1", confidence: 0.9, evidence: ["src-0001"], reason: "r" })),
  };

  it("parses a valid suspect list and keeps only known src ids", async () => {
    const ollama = mk(() => ({ content: JSON.stringify({ suspects: suspectsJson.suspects.map((s) => ({ ...s, evidence: ["src-0001", "src-9999"] })) }) }));
    const { suspects, source } = await recon(ollama, excerpts, new Set(["src-0001"]));
    expect(source).toBe("model");
    expect(suspects).toHaveLength(8);
    expect(suspects[0]!.evidence).toEqual(["src-0001"]);
  });

  it("falls back to all-likely 0.5 after two invalid outputs", async () => {
    const ollama = mk(() => ({ content: "not json" }));
    const { suspects, source } = await recon(ollama, excerpts, new Set(["src-0001"]));
    expect(source).toBe("default");
    expect(suspects.every((s) => s.confidence === 0.5 && s.likely_bug)).toBe(true);
  });
});

describe("diagnosis (T-AG-diagnose, AC-49/50)", () => {
  const base = {
    findingId: "f1",
    attackId: "A1",
    verdicts: [{ invariant: "I2", status: "fail", expected: "100 credits", actual: "300 credits", evidence: ["wf-0004", "st-0002"] }] as Verdict[],
    trace: "wf-0004 duplicate forward; st-0002 credits 300",
    source: "src-0003 grant on every delivery",
    knownEvidence: new Set(["wf-0004", "st-0002", "src-0003"]),
  };

  it("accepts a valid, evidence-backed, category-consistent diagnosis", async () => {
    const ollama = mk(() => ({
      content: JSON.stringify({ finding_id: "f1", category: "missing_dedupe", root_cause: "no event-id dedupe so credits granted per delivery", mechanism_steps: ["duplicate wf-0004 granted again (st-0002)"], evidence: ["wf-0004", "st-0002"], affected_files: ["src/routes/webhooks.ts"], confidence: 0.9, unknowns: [] }),
    }));
    const r = await diagnose(ollama, base);
    expect(r).toMatchObject({ source: "model", evidenceValid: true, rawEvidenceValid: true });
    expect(r.body.category).toBe("missing_dedupe");
  });

  it("rejects invented evidence then templates", async () => {
    const ollama = mk(() => ({
      content: JSON.stringify({ finding_id: "f1", category: "missing_dedupe", root_cause: "credits granted repeatedly for one order", mechanism_steps: ["see wh-9999"], evidence: ["wh-9999", "st-0002"], affected_files: ["src/routes/webhooks.ts"], confidence: 0.9, unknowns: [] }),
    }));
    const r = await diagnose(ollama, base);
    expect(r.source).toBe("template");
    expect(r.rawEvidenceValid).toBe(false);
    expect(r.body.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a category inconsistent with the failed invariant", async () => {
    const ollama = mk(() => ({
      content: JSON.stringify({ finding_id: "f1", category: "client_amount_trusted", root_cause: "unrelated reason about amounts entirely", mechanism_steps: ["wf-0004 then st-0002"], evidence: ["wf-0004", "st-0002"], affected_files: ["src/routes/webhooks.ts"], confidence: 0.9, unknowns: [] }),
    }));
    const r = await diagnose(ollama, base);
    expect(r.source).toBe("template"); // category rejected, repair returns same, template used
  });
});

describe("planner loop (T-AG-loop, AC-44/45/46)", () => {
  const specs = ATTACKS.filter((a) => MUST_ATTACKS.includes(a.id));
  const baseState = () => ({
    suspects: [{ q: "Q1", likely_bug: true, confidence: 0.9, attack: "A1" }],
    attacks: specs,
    allowed: new Set<AttackId>(MUST_ATTACKS),
    budget: { steps: 20, attacks: 8, patchAttempts: 2, secondsLeft: () => 900 },
  });
  const noopTools = () => ({
    runAttack: async (id: AttackId) => ({ summary: `${id} ran, 1 finding`, findings: [{ id: `find-${id}`, attackId: id, failed: ["I2"], diagnosed: false, patch: "none" }] as OpenFinding[] }),
    readSource: async () => "source",
    inspectEvidence: async () => "evidence",
    diagnoseFinding: async () => "diagnosed",
    proposeAndVerifyPatch: async () => "verified",
  });

  it("runs an attack, diagnoses, patches, then finishes — enforcing diagnose-before-patch", async () => {
    const script = [
      { tool: "run_attack", args: { attack_id: "A1", reason: "Q1 no dedupe" } },
      { tool: "propose_and_verify_patch", args: { finding_id: "find-A1" } }, // rejected: not diagnosed
      { tool: "diagnose_finding", args: { finding_id: "find-A1" } },
      { tool: "propose_and_verify_patch", args: { finding_id: "find-A1" } },
      { tool: "finish", args: { summary: "done" } },
    ];
    let i = 0;
    const ollama = mk(() => ({ content: JSON.stringify(script[Math.min(i++, script.length - 1)]) }));
    const events: PlannerEvent[] = [];
    const out = await runPlanner(ollama, baseState(), noopTools(), (e) => events.push(e));
    expect(out.degraded).toBe(false);
    const steps = events.filter((e) => e.kind === "step");
    expect(steps.find((s) => s.kind === "step" && s.tool === "propose_and_verify_patch" && !s.valid)?.error).toMatch(/diagnosed/);
    expect(steps.filter((s) => s.kind === "step" && s.valid && s.tool === "propose_and_verify_patch")).toHaveLength(1);
  });

  it("rejects attacks outside the allowed set and caps at twice", async () => {
    const script = [
      { tool: "run_attack", args: { attack_id: "A2", reason: "x" } }, // not allowed (demo Must only)
      { tool: "run_attack", args: { attack_id: "A1", reason: "x" } },
      { tool: "run_attack", args: { attack_id: "A1", reason: "x" } },
      { tool: "run_attack", args: { attack_id: "A1", reason: "x" } }, // third → rejected
      { tool: "finish", args: { summary: "done" } },
    ];
    let i = 0;
    const ollama = mk(() => ({ content: JSON.stringify(script[Math.min(i++, script.length - 1)]) }));
    const state = { ...baseState(), allowed: new Set<AttackId>(["A1"]) };
    const events: PlannerEvent[] = [];
    await runPlanner(ollama, state, noopTools(), (e) => events.push(e));
    const invalid = events.filter((e) => e.kind === "step" && !e.valid);
    expect(invalid.some((e) => e.kind === "step" && e.error?.includes("not in the allowed set"))).toBe(true);
    expect(invalid.some((e) => e.kind === "step" && e.error?.includes("twice"))).toBe(true);
  });

  it("degrades after 3 consecutive invalid outputs", async () => {
    const ollama = mk(() => ({ content: "garbage not json" }));
    const events: PlannerEvent[] = [];
    const out = await runPlanner(ollama, baseState(), noopTools(), (e) => events.push(e));
    expect(out.degraded).toBe(true);
    expect(events.some((e) => e.kind === "degraded")).toBe(true);
  });

  it("stops when the attack budget is spent and never exceeds it", async () => {
    const ollama = mk(() => ({ content: JSON.stringify({ tool: "run_attack", args: { attack_id: "A1", reason: "x" } }) }));
    const state = { ...baseState(), budget: { steps: 20, attacks: 2, patchAttempts: 2, secondsLeft: () => 900 } };
    const events: PlannerEvent[] = [];
    await runPlanner(ollama, state, noopTools(), (e) => events.push(e));
    const attackSteps = events.filter((e) => e.kind === "step" && e.valid && e.tool === "run_attack");
    expect(attackSteps).toHaveLength(2);
    expect(events.some((e) => e.kind === "stopped" && e.reason.includes("attack budget"))).toBe(true);
  });
});

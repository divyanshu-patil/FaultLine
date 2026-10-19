import { applyPatch, changedLineCount, guardPatch, parseUnifiedDiff } from "@faultline/patch";
import { getAttack, EXPECTED_MATRIX } from "@faultline/core";
import { OFFLINE_ATTACKS, runOffline, verifyOffline } from "@faultline/engine";
import type { Db } from "@faultline/db";
import type { AttackId, Verdict } from "@faultline/schemas";
import { diagnose, proposePatch, recon, withAttacks, type Ollama } from "@faultline/agent";
import { renderStoreSource } from "./source.ts";

const TITLES: Record<string, string> = {
  A1: "Credits granted more than once for one purchase",
  A2: "Order status regressed after events arrived out of order",
  A5: "A tampered price let the order complete for the wrong amount",
  A6: "Credits granted without a captured payment",
  A7: "A declined payment was treated as a success",
  A8: "A captured payment never delivered its credits",
};
const MONEY = new Set(["I2", "I3", "I5", "I6", "I7"]);
const severityOf = (failed: string[]) => (failed.some((i) => MONEY.has(i)) ? "high" : "medium");

type Deps = { db: Db; ollama: Ollama | null; backend: "simulated" | "live" };
type FindingAcc = { id: string; attackRowId: string; attackId: string; verdicts: Verdict[]; failed: string[]; title: string; severity: string; diagnosis: unknown; patch: unknown };

/** Execute one run end to end, emitting events the UI streams. Attacks run on the offline engine (simulated PayPal). */
export async function executeRun(runId: string, deps: Deps): Promise<void> {
  const { db } = deps;
  const run = await db.getRun(runId);
  if (!run) return;
  const target = await db.getTarget(run.targetId);
  if (!target) {
    await fail(db, runId, "target not found");
    return;
  }

  const emit = (kind: string, payload: Record<string, unknown>) => db.addEvent(runId, kind, payload);
  await db.updateRun(runId, { status: "running", phase: "preparing", started: true });
  await emit("phase", { phase: "preparing", backend: deps.backend });

  const bugs = target.bugs.join(",");
  const requested = (run.allowedAttacks as AttackId[]).filter((a) => OFFLINE_ATTACKS.includes(a));
  const skipped = (run.allowedAttacks as AttackId[]).filter((a) => !OFFLINE_ATTACKS.includes(a));
  if (skipped.length) await emit("info", { summary: `Skipped ${skipped.join(", ")}: need an operator forge/fault hook.` });

  const findings: FindingAcc[] = [];
  const source = renderStoreSource(bugs);

  const runAttack = async (attackId: AttackId, reason: string): Promise<{ summary: string; finding?: FindingAcc }> => {
    await emit("attack_started", { attackId, why: reason });
    const attackRowId = await db.createAttackRow({ runId, attackId, purpose: "baseline", spec: getAttack(attackId) });
    const { verdicts, failed } = await runOffline(attackId, bugs);
    await db.finishAttackRow(attackRowId, { status: "done", instanceId: "sim", verdicts, notes: null });
    for (const [i, id] of ["br-0003", "pc-0005", "wf-0004", "tr-0001", "st-0002"].entries())
      await db.addTrace({ runId, evidenceId: id, attackRowId, kind: traceKind(id), at: new Date(Date.now() + i).toISOString(), summary: { attackId }, detail: null });
    await emit("attack_finished", { attackId, failed });
    if (!failed.length) return { summary: `${attackId}: no invariant failed` };
    const finding = await db.createFinding({ runId, attackRowId, attackId, failedInvariants: failed, verdicts, evidence: ["st-0002", "wf-0004"], severity: severityOf(failed) });
    const acc: FindingAcc = { id: finding.id, attackRowId, attackId, verdicts, failed, title: TITLES[attackId] ?? `${attackId} failed ${failed.join(", ")}`, severity: severityOf(failed), diagnosis: null, patch: null };
    findings.push(acc);
    return { summary: `${attackId}: failed ${failed.join(", ")}`, finding: acc };
  };

  const diagnoseFinding = async (findingId: string): Promise<string> => {
    const acc = findings.find((f) => f.id === findingId);
    if (!acc || !deps.ollama) return "no diagnosis";
    const trace = acc.verdicts.filter((v) => v.status === "fail").map((v) => `${v.invariant}: expected ${v.expected}, actual ${v.actual} (${v.evidence.join(", ")})`).join("\n");
    const src = source.excerpts.map((e) => `<untrusted_source id="${e.srcId}">${e.text.slice(0, 1400)}</untrusted_source>`).join("\n");
    const known = new Set<string>([...source.knownSrcIds, "st-0002", "wf-0004", "pc-0005", "br-0003", "tr-0001"]);
    const d = await diagnose(deps.ollama, { findingId, attackId: acc.attackId, verdicts: acc.verdicts, trace, source: src, knownEvidence: known });
    acc.diagnosis = { source: d.source, body: d.body, evidenceValid: d.evidenceValid };
    await db.addDiagnosis({ findingId, source: d.source, body: d.body, evidenceValid: d.evidenceValid, rawEvidenceValid: d.rawEvidenceValid });
    await emit("diagnosis", { attackId: acc.attackId, source: d.source, root_cause: d.body.root_cause });
    return `${acc.attackId} diagnosed (${d.source}): ${d.body.root_cause.slice(0, 90)}`;
  };

  const proposeAndVerifyPatch = async (findingId: string): Promise<string> => {
    const acc = findings.find((f) => f.id === findingId);
    if (!acc || !deps.ollama) return "no patch";
    const affected = (acc.diagnosis as { body?: { affected_files?: string[] } } | null)?.body?.affected_files ?? ["src/routes/webhooks.ts"];
    const files = affected.filter((p) => source.files[p]).map((p) => ({ path: p, content: source.files[p]! }));
    const promptFiles = files.length ? files : [{ path: "src/routes/webhooks.ts", content: source.files["src/routes/webhooks.ts"]! }];
    const affectedPaths = promptFiles.map((f) => f.path);
    const diff = await proposePatch(deps.ollama, { diagnosis: (acc.diagnosis as { body?: { root_cause?: string } } | null)?.body?.root_cause ?? acc.title, files: promptFiles });
    const guard = guardPatch(diff, source.files, affectedPaths);
    // status progresses: rejected (guard) → build_failed (apply) → verified | not_fixed (same attack re-run on the patched store)
    let status: "rejected" | "build_failed" | "verified" | "not_fixed" = "rejected";
    let applied = false;
    let verdicts: Verdict[] | null = null;
    if (guard.passed) {
      status = "build_failed";
      try {
        const patches = parseUnifiedDiff(diff);
        const patchedFiles = applyPatch(source.files, patches);
        applied = changedLineCount(patches) > 0;
        if (applied) {
          // Prove the fix: re-run the SAME attack on a fresh store built from the patched source, same checker.
          const result = await verifyOffline(acc.attackId as AttackId, bugs, patchedFiles);
          verdicts = result.verdicts;
          status = result.verified ? "verified" : "not_fixed";
        }
      } catch (err) {
        await emit("info", { summary: `${acc.attackId} patch did not apply or verify: ${(err as Error).message}` });
      }
    }
    const label = status === "verified" ? "AI patch (verified by re-run)" : status === "not_fixed" ? "AI patch (re-run, did not fix)" : "AI patch (rejected)";
    const build = { passed: applied };
    const patchId = await db.addPatch({ findingId, attempt: 1, source: "model", diff, guard, build, status });
    acc.patch = { attempt: 1, source: "model", diff, guard, build, status, verdicts, label };
    await db.updatePatch(patchId, { status, verdicts });
    await emit("patch", { attackId: acc.attackId, status, source: "model" });
    return `${acc.attackId} patch ${status} (guard ${guard.passed ? "passed" : "failed"})`;
  };

  // --- recon + attack phase ---
  let degraded = false;
  if (run.mode === "agent" && deps.ollama) {
    await emit("phase", { phase: "recon" });
    const { suspects, source: reconSource } = await recon(deps.ollama, source.excerpts, source.knownSrcIds);
    await emit("suspects", { summary: `Recon ${reconSource === "model" ? "flagged" : "defaulted"} suspects across the store's payment code.` });
    degraded = reconSource === "default";

    // The AI reads the code and ranks suspects; we run the requested attacks (highest-confidence suspect first),
    // then the AI diagnoses and patches each finding. The planner loop is available in @faultline/agent; the worker
    // uses this linear flow so a run always covers its attacks regardless of planner variance.
    await emit("phase", { phase: "attacking" });
    const rank = new Map(withAttacks(suspects).map((s) => [s.attack, s.confidence]));
    const ordered = [...requested].sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));
    for (const attackId of ordered) {
      if (await db.isCancelRequested(runId)) break;
      await emit("agent_step", { tool: "run_attack", why: `${attackId}${rank.get(attackId) ? ` (suspect confidence ${rank.get(attackId)!.toFixed(2)})` : ""}` });
      await runAttack(attackId, "agent-selected");
    }
    await emit("phase", { phase: "diagnosing" });
    for (const f of findings) {
      if (await db.isCancelRequested(runId)) break;
      await emit("agent_step", { tool: "diagnose_finding", why: f.attackId });
      await diagnoseFinding(f.id);
    }
    await emit("phase", { phase: "patching" });
    for (const f of findings) {
      if (await db.isCancelRequested(runId)) break;
      await emit("agent_step", { tool: "propose_patch", why: f.attackId });
      await proposeAndVerifyPatch(f.id);
    }
  } else {
    if (run.mode === "agent") {
      degraded = true;
      await db.updateRun(runId, { effectiveMode: "checklist" });
      await emit("info", { summary: "AI unavailable — ran every attack in checklist mode." });
    }
    await emit("phase", { phase: "attacking" });
    for (const attackId of requested) {
      if (await db.isCancelRequested(runId)) break;
      await runAttack(attackId, "checklist");
    }
  }

  if (await db.isCancelRequested(runId)) {
    await db.updateRun(runId, { status: "cancelled", phase: "done", finished: true });
    await emit("phase", { phase: "done", cancelled: true });
    return;
  }

  // --- report ---
  await emit("phase", { phase: "reporting" });
  const slug = `run-${runId.slice(0, 8)}`;
  const aiFixed = findings.filter((f) => (f.patch as { status?: string } | null)?.status === "verified").length;
  const body = {
    slug,
    target: { name: target.name, slug: target.slug },
    mode: run.mode,
    effectiveMode: degraded ? "checklist" : run.mode,
    model: run.model,
    createdAt: new Date().toISOString(),
    usage: { attacks: requested.length },
    backend: deps.backend,
    summary: { headline: `${findings.length} bug${findings.length === 1 ? "" : "s"} found on ${target.name}${deps.backend === "simulated" ? " (simulated PayPal backend)" : ""}`, counts: { bugsProven: findings.length, aiFixed, attacks: requested.length } },
    findings: findings.map((f) => ({ id: f.id, attackId: f.attackId, title: f.title, severity: f.severity, failedInvariants: f.failed, verdicts: f.verdicts, diagnosis: f.diagnosis, patch: f.patch })),
    realVsSimulated: requested.map((a) => ({ attackId: a, text: getAttack(a).realVsSimulated })),
  };
  await db.createReport(runId, slug, body);
  await db.updateRun(runId, { status: "completed", phase: "done", finished: true, summary: body.summary, effectiveMode: degraded ? "checklist" : run.mode });
  await emit("phase", { phase: "done" });
}

async function fail(db: Db, runId: string, message: string): Promise<void> {
  await db.updateRun(runId, { status: "failed", phase: "done", finished: true, error: { message } });
  await db.addEvent(runId, "error", { message });
}

function traceKind(id: string): "browser_step" | "paypal_call" | "webhook_forward" | "truth_read" | "state_snapshot" {
  return id.startsWith("br") ? "browser_step" : id.startsWith("pc") ? "paypal_call" : id.startsWith("wf") ? "webhook_forward" : id.startsWith("tr") ? "truth_read" : "state_snapshot";
}

export { EXPECTED_MATRIX };

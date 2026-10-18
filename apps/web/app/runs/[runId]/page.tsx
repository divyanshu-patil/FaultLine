"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PhaseStepper } from "../../../components/PhaseStepper";
import { InvariantBoard } from "../../../components/InvariantBoard";
import { Chip } from "../../../components/Chip";
import { useRunStream } from "../../../lib/useRunStream";
import type { RunDetail, Finding, Verdict } from "../../../lib/types";

const LANES: [string, string[]][] = [
  ["Browser", ["browser_step"]],
  ["Store", ["state_snapshot", "source_excerpt"]],
  ["Proxy", ["webhook_forward"]],
  ["PayPal", ["paypal_call", "webhook_delivery", "truth_read"]],
  ["Checker", ["invariant_result"]],
];
type TraceItem = { evidenceId: string; kind: string; summary: Record<string, unknown> };

const DONE = new Set(["completed", "failed", "cancelled"]);

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [history, setHistory] = useState<{ kind: string; payload: Record<string, unknown> }[]>([]);
  const [notFound, setNotFound] = useState(false);
  const done = run ? DONE.has(run.status) : false;
  const liveEvents = useRunStream(runId, done);

  useEffect(() => {
    let stop = false;
    async function load() {
      const [r, t, e] = await Promise.all([fetch(`/api/runs/${runId}`), fetch(`/api/runs/${runId}/trace`), fetch(`/api/runs/${runId}/events?after=0`)]);
      if (stop) return;
      if (r.status === 404) return setNotFound(true);
      if (r.ok) setRun(await r.json());
      if (t.ok) setTrace(await t.json());
      if (e.ok) setHistory(await e.json());
    }
    load();
    const interval = done ? null : setInterval(load, 2500);
    return () => {
      stop = true;
      if (interval) clearInterval(interval);
    };
    // re-arm when the run reaches a terminal state
  }, [runId, done, liveEvents.length]);

  if (notFound)
    return (
      <main className="section">
        <div className="wrap">
          <h1>Run not found</h1>
          <p>
            This run does not exist or belongs to another session. <Link className="link" href="/runs/new">Start a new one</Link>.
          </p>
        </div>
      </main>
    );

  if (!run)
    return (
      <main className="section">
        <div className="wrap">
          <p className="muted">Loading run…</p>
        </div>
      </main>
    );

  const degraded = run.mode === "agent" && run.effectiveMode === "checklist";
  const LOG_KINDS = ["agent_step", "suspects", "attack_finished", "diagnosis", "patch", "degraded", "info"];
  const agentLog = [...history, ...liveEvents].filter((e) => LOG_KINDS.includes(e.kind));

  return (
    <main className="section">
      <div className="wrap">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">Crash test · {run.target.name}</div>
            <h1 style={{ fontSize: 40 }}>
              {run.mode === "agent" ? "Agent" : "Checklist"} run
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Chip status={run.status === "completed" ? "pass" : run.status === "failed" ? "fail" : "plain"}>{run.status}</Chip>
            {run.reportSlug ? (
              <Link className="btn sm ember" href={`/reports/${run.reportSlug}`}>
                Open report →
              </Link>
            ) : null}
          </div>
        </div>

        {degraded ? (
          <div className="card" style={{ marginTop: 16, background: "var(--ember-wash)", borderLeft: "3px solid var(--ember)" }}>
            <b style={{ fontFamily: "var(--font-display)" }}>Ran in checklist mode.</b> The AI was unavailable, so FaultLine ran every selected attack without it.
          </div>
        ) : null}

        {run.summary?.headline ? (
          <div className="card asym" style={{ marginTop: 20, background: "var(--ivory)" }}>
            <b style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{run.summary.headline}</b>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0,1fr)", marginTop: 28 }} className="run-grid">
          <section aria-label="Phase and agent log">
            <PhaseStepper phase={run.phase} status={run.status} />
            <div className="card" style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Agent log</div>
              {agentLog.length === 0 ? (
                <p className="muted" style={{ fontSize: 14, margin: 0 }} aria-live="polite">
                  {run.mode === "checklist" ? "No AI in checklist mode." : done ? "No agent steps recorded." : "Waiting for the agent…"}
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }} aria-live="polite">
                  {agentLog.map((e, i) => {
                    const p = e.payload;
                    const label = String(p.tool ?? p.attackId ?? e.kind.replace(/_/g, " "));
                    const failed = Array.isArray(p.failed) ? ` failed ${(p.failed as string[]).join(", ")}` : "";
                    const text = String(p.why ?? p.summary ?? p.root_cause ?? p.reason ?? (p.status ? `${e.kind} ${p.status}` : "")) + failed;
                    return (
                      <li key={i} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                        <span className="chip tag" style={{ flex: "none" }}>
                          {label}
                        </span>
                        <span className="muted">{text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section aria-label="Attack timeline and verdicts">
            <div className="card data">
              <div className="eyebrow" style={{ marginBottom: 12 }}>Invariant board</div>
              <InvariantBoard rows={run.attacks.filter((a) => a.purpose === "baseline").map((a) => ({ attackId: a.attackId, verdicts: a.verdicts }))} />
            </div>

            <div className="card data" style={{ marginTop: 20 }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Timeline</div>
              <div style={{ display: "grid", gap: 6 }}>
                {LANES.map(([label, kinds]) => {
                  const items = trace.filter((t) => kinds.includes(t.kind));
                  return (
                    <div className="lanes" key={label}>
                      <div className="lane-label">{label}</div>
                      <div className="lane-track">
                        {items.length === 0 ? (
                          <span className="muted" style={{ fontSize: 12 }}>—</span>
                        ) : (
                          items.map((t) => (
                            <span key={t.evidenceId} className={`dot ${t.summary?.injected ? "injected" : ""}`} title={JSON.stringify(t.summary)}>
                              {t.evidenceId}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Findings</div>
              {run.findings.length === 0 ? (
                <p className="muted">{done ? "No failing invariants — the store held up." : "No findings yet."}</p>
              ) : (
                <div className="grid" style={{ gap: 12 }}>
                  {run.findings.map((f) => (
                    <FindingRow key={f.id} runId={runId} finding={f} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <style>{`@media (min-width: 960px){ .run-grid{ grid-template-columns: 300px 1fr !important; } }`}</style>
    </main>
  );
}

function FindingRow({ runId, finding }: { runId: string; finding: Finding }) {
  const failing = finding.verdicts.filter((v: Verdict) => v.status === "fail");
  return (
    <Link href={`/runs/${runId}/findings/${finding.id}`} className="card" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <h3 style={{ fontSize: 17 }}>
          <span className="mono ember">{finding.attackId}</span> {failing[0] ? `${failing[0].invariant} failed` : "finding"}
        </h3>
        <Chip status={finding.severity === "high" ? "high" : "tag"}>{finding.severity}</Chip>
      </div>
      {failing[0] ? (
        <p style={{ margin: "8px 0 0", fontSize: 14 }}>
          Expected <b>{failing[0].expected}</b>, got <b className="ember">{failing[0].actual}</b>.
        </p>
      ) : null}
    </Link>
  );
}

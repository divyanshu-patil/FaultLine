import Link from "next/link";
import { getJson, type FindingDetail } from "../../../../../lib/api";
import { Chip } from "../../../../../components/Chip";
import { DiffViewer } from "../../../../../components/DiffViewer";
import { ProofCards } from "../../../../../components/ProofCards";

export default async function FindingPage({ params }: { params: Promise<{ runId: string; findingId: string }> }) {
  const { runId, findingId } = await params;
  const finding = await getJson<FindingDetail>(`/api/findings/${findingId}`);
  if (!finding)
    return (
      <main className="section">
        <div className="wrap">
          <h1>Finding not found</h1>
          <p>
            <Link className="link" href={`/runs/${runId}`}>
              Back to the run
            </Link>
          </p>
        </div>
      </main>
    );

  const failing = finding.verdicts.filter((v) => v.status === "fail");
  const diag = finding.diagnosis;
  const verified = finding.patches.find((p) => p.status === "verified");
  const lastPatch = verified ?? finding.patches[finding.patches.length - 1];
  const patchLabel = lastPatch ? (lastPatch.source === "model" ? "AI patch" : "Reference fix (not AI-generated)") : "";

  return (
    <main className="section">
      <div className="wrap" style={{ maxWidth: 900 }}>
        <Link className="muted" href={`/runs/${runId}`} style={{ fontSize: 13 }}>
          ← Back to run
        </Link>
        <div className="eyebrow" style={{ marginTop: 16 }}>
          Finding · attack <span className="mono">{finding.attackId}</span>
        </div>
        <h1 style={{ fontSize: 40 }}>{diag?.body.root_cause ?? `${finding.attackId} failed ${finding.failedInvariants.join(", ")}`}</h1>

        <section style={{ marginTop: 36 }}>
          <h2>What happened</h2>
          <div className="grid" style={{ gap: 10, marginTop: 14 }}>
            {failing.map((v) => (
              <div className="card data" key={v.invariant} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", padding: 18 }}>
                <div>
                  <b className="mono">{v.invariant}</b>{" "}
                  <span className="muted" style={{ fontSize: 13 }}>
                    expected {v.expected}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="ember mono">{v.actual}</span>
                  <Chip status="fail">fail</Chip>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2>Why</h2>
            {diag ? <Chip status="tag">{diag.source === "model" ? "AI explanation" : "Template explanation"}</Chip> : null}
          </div>
          {diag ? (
            <div style={{ marginTop: 14 }}>
              <p>{diag.body.root_cause}</p>
              <ol style={{ margin: "12px 0 0", paddingLeft: 20, display: "grid", gap: 8 }}>
                {diag.body.mechanism_steps.map((s, i) => (
                  <li key={i} style={{ color: "var(--steel)" }}>
                    {renderWithEvidence(s)}
                  </li>
                ))}
              </ol>
              <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
                Confidence {Math.round(diag.body.confidence * 100)}% · evidence {diag.body.evidence.map((e) => <span key={e} className="mono"> {e}</span>)} · files{" "}
                {diag.body.affected_files.join(", ")}
              </p>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 14 }}>No diagnosis recorded.</p>
          )}
        </section>

        {lastPatch ? (
          <section style={{ marginTop: 36 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h2>Patch</h2>
              <Chip status="tag">{patchLabel}</Chip>
              <Chip status={lastPatch.status === "verified" ? "pass" : lastPatch.status === "illustrative" ? "tag" : "fail"}>{lastPatch.status === "illustrative" ? "not re-run" : lastPatch.status}</Chip>
            </div>
            {lastPatch.guard.passed ? null : (
              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Guard rejected an earlier attempt: {lastPatch.guard.reasons.join("; ")}</p>
            )}
            <div style={{ marginTop: 14 }}>
              <DiffViewer diff={lastPatch.diff} />
            </div>
          </section>
        ) : null}

        {lastPatch?.verdicts ? (
          <section style={{ marginTop: 36 }}>
            <h2>Proof</h2>
            <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>{lastPatch.status === "illustrative" ? "Worked example: the checker run on a constructed post-fix state, not a re-run attack." : "Same attack, same rules, fresh patched store."}</p>
            <div style={{ marginTop: 16 }}>
              <ProofCards before={finding.verdicts} after={lastPatch.verdicts} label={lastPatch.status === "verified" ? patchLabel + " — fixed" : lastPatch.status === "illustrative" ? "expected after the fix (not re-run)" : "still failing"} />
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function renderWithEvidence(text: string) {
  const parts = text.split(/\b((?:pc|wh|wf|br|st|tr|iv|src)-\d{4})\b/g);
  return parts.map((p, i) => (/^(pc|wh|wf|br|st|tr|iv|src)-\d{4}$/.test(p) ? <span key={i} className="mono ember">{p}</span> : <span key={i}>{p}</span>));
}

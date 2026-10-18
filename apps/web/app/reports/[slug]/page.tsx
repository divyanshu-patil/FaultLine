import Link from "next/link";
import { getJson, type Report } from "../../../lib/api";
import { Chip } from "../../../components/Chip";
import { DiffViewer } from "../../../components/DiffViewer";
import { ProofCards } from "../../../components/ProofCards";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `Report — FaultLine`, alternates: { canonical: `/reports/${slug}` } };
}

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = await getJson<Report>(`/api/reports/${slug}`, { authed: false });
  if (!report)
    return (
      <main className="section">
        <div className="wrap">
          <h1>Report not found</h1>
          <p>This report link is not valid.</p>
        </div>
      </main>
    );

  const counts = report.summary.counts ?? {};
  return (
    <main className="section">
      <div className="wrap" style={{ maxWidth: 940 }}>
        <div className="eyebrow">Report · {report.target.name}</div>
        <h1 style={{ fontSize: 46 }}>{report.summary.headline}</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, alignItems: "center" }}>
          <Chip status="tag">{report.effectiveMode === "agent" ? "Agent mode" : "Checklist mode"}</Chip>
          <Chip status="plain">{report.model ?? "no model"}</Chip>
          <Chip status="plain">{new Date(report.createdAt).toLocaleDateString()}</Chip>
          <a className="btn sm ghost" href={`/api/reports/${slug}?format=md`}>
            Download Markdown
          </a>
        </div>

        <div className="grid three" style={{ marginTop: 28 }}>
          {[
            ["Bugs found", counts.bugsProven ?? report.findings.length],
            ["Fixed by AI patch", counts.aiFixed ?? 0],
            ["Attacks run", counts.attacks ?? 0],
          ].map(([label, n]) => (
            <div className="card data" key={label as string}>
              <div className="display" style={{ fontSize: 48 }}>
                {n as number}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 48 }}>Findings</h2>
        <div className="grid" style={{ gap: 20, marginTop: 16 }}>
          {report.findings.map((f) => (
            <article id={f.id} className="card" key={f.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <h3>
                  <span className="mono ember">{f.attackId}</span> {f.title}
                </h3>
                <Chip status={f.severity === "high" ? "high" : "tag"}>{f.severity}</Chip>
              </div>
              {f.diagnosis ? (
                <>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                    <Chip status="tag">{f.diagnosis.source === "model" ? "AI explanation" : "Template explanation"}</Chip>
                  </div>
                  <p style={{ marginTop: 10 }}>{f.diagnosis.body.root_cause}</p>
                </>
              ) : null}
              {f.patch ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <Chip status="tag">{f.patch.label}</Chip>
                    <Chip status={f.patch.status === "verified" ? "pass" : f.patch.status === "illustrative" ? "tag" : "fail"}>{f.patch.status === "illustrative" ? "not re-run" : f.patch.status}</Chip>
                  </div>
                  <DiffViewer diff={f.patch.diff} />
                  {f.patch.verdicts ? (
                    <div style={{ marginTop: 16 }}>
                      <ProofCards before={f.verdicts} after={f.patch.verdicts} label={f.patch.status === "verified" ? "fixed" : f.patch.status === "illustrative" ? "expected after the fix (not re-run)" : "still failing"} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <h2 style={{ marginTop: 48 }}>What was real, what was simulated</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 10 }}>
          {report.realVsSimulated.map((r) => (
            <li key={r.attackId} style={{ display: "flex", gap: 10, fontSize: 14 }}>
              <span className="mono ember" style={{ flex: "none" }}>
                {r.attackId}
              </span>
              <span className="muted">{r.text}</span>
            </li>
          ))}
        </ul>

        <p className="muted" style={{ marginTop: 40, fontSize: 13 }}>
          Sandbox only. Verdicts come from deterministic checks against PayPal&apos;s own record, not the AI. <Link className="link" href="/">FaultLine</Link>.
        </p>
      </div>
    </main>
  );
}

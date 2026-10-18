import type { Verdict } from "../lib/api";
import { Chip } from "./Chip";

function VerdictList({ verdicts }: { verdicts: Verdict[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
      {verdicts.map((v) => (
        <li key={v.invariant} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
          <span className="mono">{v.invariant}</span>
          <Chip status={v.status === "pass" ? "pass" : v.status === "fail" ? "fail" : "na"}>{v.status}</Chip>
        </li>
      ))}
    </ul>
  );
}

/** Before (red) → after (green or still red), same attack, same rules (docs/11 S5). */
export function ProofCards({ before, after, label }: { before: Verdict[]; after: Verdict[] | null; label: string }) {
  const fixed = after && after.every((v) => v.status !== "fail");
  return (
    <div className="grid two" style={{ alignItems: "start" }}>
      <div className="card" style={{ borderTop: "3px solid var(--ember)" }}>
        <div className="eyebrow" style={{ color: "var(--ember)" }}>Before — bug reproduced</div>
        <VerdictList verdicts={before} />
      </div>
      <div className="card" style={{ borderTop: `3px solid ${fixed ? "var(--ok)" : "var(--ember)"}` }}>
        <div className="eyebrow" style={{ color: fixed ? "var(--ok)" : "var(--ember)" }}>
          After — {label}
        </div>
        {after ? <VerdictList verdicts={after} /> : <p style={{ marginTop: 12 }}>Not re-run.</p>}
      </div>
    </div>
  );
}

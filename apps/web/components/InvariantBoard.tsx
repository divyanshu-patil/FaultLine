import type { Verdict } from "../lib/api";

const ALL_INVARIANTS = ["I1", "I2", "I3", "I4", "I5", "I6", "I7"];

export type AttackRow = { attackId: string; verdicts: Verdict[] | null };

/** Attacks × invariants grid. Pass/fail shown by colour, icon and text so colour is never the only signal (AC-61). */
export function InvariantBoard({ rows }: { rows: AttackRow[] }) {
  const cell = (row: AttackRow, inv: string) => {
    const v = row.verdicts?.find((x) => x.invariant === inv);
    if (!v) return <span className="cell na" title="not run" aria-label="not run" />;
    if (v.status === "not_applicable") return <span className="cell na" title="not applicable" aria-label="not applicable">–</span>;
    const sign = v.status === "pass" ? "✓" : "✕";
    return (
      <span className={`cell ${v.status}`} title={`${inv} ${v.status}: expected ${v.expected}, actual ${v.actual}`} aria-label={`${inv} ${v.status}`}>
        {sign}
      </span>
    );
  };
  return (
    <table className="board">
      <thead>
        <tr>
          <th aria-hidden />
          {ALL_INVARIANTS.map((i) => (
            <th key={i}>{i}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.attackId}>
            <td className="rowhead">{row.attackId}</td>
            {ALL_INVARIANTS.map((inv) => (
              <td key={inv}>{cell(row, inv)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

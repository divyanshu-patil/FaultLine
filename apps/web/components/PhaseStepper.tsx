import { PHASES } from "../lib/types";

const LABELS: Record<string, string> = {
  queued: "Queued", preparing: "Preparing", recon: "Recon", attacking: "Attacking",
  diagnosing: "Diagnosing", patching: "Patching", verifying: "Verifying", reporting: "Reporting", done: "Done",
};

export function PhaseStepper({ phase, status }: { phase: string; status: string }) {
  const current = PHASES.indexOf(phase as (typeof PHASES)[number]);
  const finished = status === "completed" || status === "failed" || status === "cancelled";
  return (
    <ol className="stepper" aria-label="Run phase">
      {PHASES.map((p, i) => {
        const state = finished || i < current ? "done" : i === current ? "active" : "";
        return (
          <li key={p} className={`step ${state}`} aria-current={i === current && !finished ? "step" : undefined}>
            <span className="bead" aria-hidden />
            {LABELS[p]}
          </li>
        );
      })}
    </ol>
  );
}

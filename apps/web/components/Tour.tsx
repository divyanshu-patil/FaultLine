"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

type Step = { sel: string; title: string; text: string; side?: "top" | "bottom" | "left" | "right" };

// Steps are anchored to [data-tour="<sel>"] elements; absent anchors are skipped.
const HOME: Step[] = [
  { sel: "run", title: "Start a crash test", text: "Point the agent at the demo store. It places real sandbox orders, then recreates the ways a checkout breaks.", side: "bottom" },
  { sel: "loop", title: "One loop per bug", text: "Recon → attack → verdict → diagnose → patch → prove, repeated for every attack.", side: "top" },
  { sel: "judge", title: "The AI never decides truth", text: "Pass and fail come only from deterministic checks against PayPal's own record — never from the model.", side: "top" },
  { sel: "report", title: "See a finished report", text: "Every finding gets a plain explanation, a fix, and proof the fix actually works.", side: "bottom" },
];

const RUN: Step[] = [
  { sel: "phases", title: "Live phases", text: "The run streams through recon, attacking, diagnosing, patching and verifying as it happens.", side: "right" },
  { sel: "invariants", title: "Invariant board", text: "Each attack's deterministic checks (I1–I7). A red cell is a real failure the checker found — not the AI's opinion.", side: "left" },
  { sel: "agentlog", title: "Agent log", text: "What Gemma did: the suspects it flagged in the code, the attacks it chose, its diagnoses and patches.", side: "right" },
  { sel: "findings", title: "Findings", text: "Each proven bug. Open one to see the cause, the AI's patch, and the before/after proof from re-running the attack.", side: "top" },
];

function stepsFor(path: string): Step[] {
  if (path === "/") return HOME;
  if (/^\/runs\/[^/]+$/.test(path)) return RUN;
  return [];
}

function toDriveSteps(steps: Step[]): DriveStep[] {
  return steps
    .filter((s) => document.querySelector(`[data-tour="${s.sel}"]`))
    .map((s) => ({ element: `[data-tour="${s.sel}"]`, popover: { title: s.title, description: s.text, side: s.side ?? "bottom", align: "start" } }));
}

export function Tour() {
  const path = usePathname();

  const start = useCallback(() => {
    const steps = toDriveSteps(stepsFor(path));
    if (!steps.length) return;
    driver({ showProgress: true, overlayColor: "#202020", overlayOpacity: 0.55, stagePadding: 6, stageRadius: 10, popoverClass: "fl-tour", nextBtnText: "Next", prevBtnText: "Back", doneBtnText: "Done", steps }).drive();
  }, [path]);

  // Auto-start once for a first-time visitor on the home page.
  useEffect(() => {
    if (path !== "/") return;
    let seen = true;
    try {
      seen = localStorage.getItem("fl-tour-v1") === "1";
    } catch {
      seen = true;
    }
    if (seen) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem("fl-tour-v1", "1");
      } catch {
        /* ignore */
      }
      start();
    }, 700);
    return () => clearTimeout(t);
  }, [path, start]);

  if (!stepsFor(path).length) return null;
  return (
    <button type="button" className="tour-btn" onClick={start} aria-label="Take a guided tour">
      Tour
    </button>
  );
}

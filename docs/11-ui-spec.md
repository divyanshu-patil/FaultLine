# 11. UI spec (Next.js)

**Visual design is owned by `docs/design.md`** (colours, type, spacing, components, motion, tone). This file defines screens, content, behaviour and states only. Where the two conflict, `design.md` wins on look; this file wins on behaviour. If `design.md` is missing, build with neutral defaults and leave `TODO(design)` markers.

## 1. Global

- App Router, server components for static content, client components for live views.
- All data via `lib/api.ts` (typed with `@cct/schemas`) against `/api/*` (same-origin rewrite).
- Persistent top bar: product name, "SANDBOX ONLY" badge (always visible), nav (Runs, Attacks, About), session state.
- Every screen has loading, empty and error states. Errors show the API `code` and `requestId`.
- Accessibility: keyboard reachable; focus visible; live regions (`aria-live="polite"`) for new run events; colour is never the only signal (pass/fail also uses text and icons); respects `prefers-reduced-motion`.
- Works at 375 px width (judges may open on a phone); timeline collapses to a vertical list.

## 2. Screens

### S1. Home `/`
- One-line pitch + the child-level explanation (`docs/01` §2), shortened.
- Primary button **Run the demo crash test** → `/runs/new?target=buggybeans:demo&mode=agent`.
- Secondary: **See a finished report** (pinned demo report link), **Browse the victim store** (public BuggyBeans URL).
- "How it works" strip: Recon → Attack → Verdict → Diagnose → Patch → Prove.
- Footer: what is real vs simulated; sandbox-only statement; repo link; licence.

### S2. Login `/login`
- Access-code field, submit, error message for wrong code, rate-limit message with wait time.

### S3. New run `/runs/new`
- Target picker (cards): Demo (5 seeded bugs), All bugs, Fixed store (expect all green), Custom (checkbox list B1–B8 with plain descriptions; selecting reveals that the bugs are seeded, so the run page shows "seeded bugs: hidden from the AI").
- Mode toggle: **Agent** (AI plans, explains, patches) / **Checklist** (no AI, runs every selected attack).
- Advanced (collapsed): attack checklist (Must pre-ticked), budget sliders within caps.
- Start → `POST /api/runs` → redirect to S4. Disabled with reason when a run is already active.

### S4. Live run `/runs/[runId]`
Layout (desktop): left column = phase stepper + agent log; centre = attack timeline; right = invariant board + findings.

- **Phase stepper:** queued → preparing → recon → attacking → diagnosing → patching → verifying → reporting → done. Current phase highlighted; degraded mode banner if applicable.
- **Agent log:** one row per `agent_step`: tool name as a chip (`run_attack A1`), the model's short "why", and the outcome. Recon shows suspects as a table (question, likely bug?, confidence bar, evidence links).
- **Attack timeline:** per attack, four swimlanes **Browser · Store · Proxy · PayPal**. Each trace item is a dot with its evidence ID; hover/focus shows a summary; click opens the evidence drawer (S7). Injected faults and forged events are marked "injected by CCT".
- **Invariant board:** grid of attacks × invariants with pass / fail / not applicable / not run. Fail cells show `expected → actual`.
- **Findings:** cards with severity, attack, failed invariants, diagnosis status, patch status (rejected / not fixed / verified ✓ / reference fix).
- Cancel button (confirm dialog).
- On completion: banner with summary ("4 bugs proven, 3 fixed by AI patches, 1 reference fix") and **Open report**.

### S5. Finding `/runs/[runId]/findings/[findingId]`
- Header: plain-language title from the diagnosis ("Credits granted three times for one purchase").
- **What happened:** the failed invariants with expected/actual.
- **Why (AI diagnosis):** root cause, mechanism steps with evidence chips; label "AI explanation" or "Template explanation"; confidence; unknowns.
- **Evidence:** list of cited trace items; each opens the evidence drawer.
- **Patch:** diff viewer (unified, syntax-highlighted), guard result, build result, attempt tabs.
- **Proof:** before/after cards: same attack, same rules; before = red with failing invariants; after = green or still red. Labels: "AI patch" or "Reference fix (not AI-generated)".

### S6. Report `/reports/[slug]` (public, no login)
- Summary, target, mode, model, budget used, date.
- Findings table with links to anchors; each finding as in S5 but read-only.
- "What was real, what was simulated" section generated from attack specs.
- Download Markdown / JSON (Should). Print stylesheet.

### S7. Evidence drawer (component)
- Shows one trace item: kind, time, redacted summary, and detail (JSON viewer, screenshot, or raw webhook body with signature hashed). Copy evidence ID button.

### S8. Attacks catalog `/attacks`
- One card per attack from `GET /api/attacks`: what it disturbs, which invariants, real vs simulated, priority.

### S9. About `/about`
- How CCT works, safety model (sandbox only, AI never judges, patches only in throwaway copies), limitations, credits.

## 3. Component list

`TopBar`, `SandboxBadge`, `PhaseStepper`, `AgentLog`, `SuspectsTable`, `AttackTimeline`, `TraceDot`, `EvidenceDrawer`, `InvariantBoard`, `FindingCard`, `DiffViewer`, `ProofCards`, `RunSummaryBanner`, `TargetPicker`, `ModeToggle`, `BudgetControls`, `ReportView`, `EmptyState`, `ErrorState`.

## 4. Live data behaviour

- `useRunStream(runId)`: EventSource on `/api/runs/:id/stream`; on error, falls back to polling `/events?after=` every 2 s; dedupes by event id; reconnect with backoff.
- The page renders from an event-sourced reducer so a refresh mid-run reconstructs the same view from `/api/runs/:id` + events.

## 5. Copy rules

- Never say "secure", "guaranteed" or "certified". Say "found", "proven by re-run", "not found in this run".
- Always say "sandbox". Never imply real money moved.
- Distinguish "AI explanation" from "checker verdict" visually and in words.

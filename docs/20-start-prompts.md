# 20. Start prompts for your coding agent

Give these one at a time. Each prompt assumes the agent has the repo with `AGENTS.md`, `judging.md` and `docs/` (including your `docs/design.md`). Ask the agent to stop at the end of each prompt and report: tasks done, acceptance criteria passing, open questions.

## Prompt 0 — Orientation (no code)

```text
Read AGENTS.md, then docs/01, 02, 04, 05, 06, 13. Do not write code.
Reply with: (1) a 10-line summary of the system; (2) the list of Must tasks for Phase 1 with IDs; (3) every ⚠️/❓ item that Phase 1 depends on; (4) questions you need answered.
```

## Prompt 1 — Spikes helper scripts (Phase 0)

```text
Create scripts/spikes/ with small standalone TypeScript scripts for S0 (token, create, capture, get order), S2 (logging webhook receiver on a port), S3 (replay a stored delivery to verify-webhook-signature), S4 (double capture with PayPal-Request-Id), S5 (negative-testing header on capture), S6 (Ollama /api/tags + 20 tool-call trials + 20 JSON trials with timing), S8 (SKIP LOCKED + LISTEN/NOTIFY on DATABASE_URL).
Each script reads env via zod, uses only https://api-m.sandbox.paypal.com, never prints secrets, and writes results as JSON to spikes-out/. Also write a minimal HTML page with PayPal buttons and a Playwright script for S1 that attempts popup approval 10 times and reports success count.
Follow docs/18 §1. Do not build product code yet.
```

## Prompt 2 — Scaffold (P1-1, P1-2, P1-3)

```text
Implement P1-1, P1-2, P1-3 from docs/13: the Turborepo layout in docs/03 §1 (empty apps with createApp factories and health routes), packages/config, @cct/schemas (all schemas named in docs/04, 05, 06, 09), @cct/db (Drizzle schema for every table in docs/08, migrations, job claim query, notify trigger). CI per docs/03 §6 including check-no-prod-host.sh and the bundle grep.
Tests: schema round-trips; job claim with two concurrent workers takes different jobs.
```

## Prompt 3 — BuggyBeans (P1-4, P1-5)

```text
Implement apps/buggybeans per docs/10: fixed form first (flows in §4), then bug paths B1, B3, B4, B5, B7 switched by BUGS, the probe and catalog endpoints, and scripts/render-variant.ts (removes inactive bug branches). It must not import @cct/paypal. Unit-test each bug flag against FakePayPal (packages/testing; create FakePayPal per docs/15 §2). Validate the probe against @cct/schemas/probe.
```

## Prompt 4 — Trace, PayPal client, proxy (P1-6, P1-7)

```text
Implement @cct/paypal (allowlist, token cache, truth reads, verify helper), @cct/trace (recorder, evidence IDs per docs/04 F8, redaction), and apps/proxy per docs/09 §2: webhook ingress with raw bytes and fast ack, correlation per docs/02 §6, pass-through forwarding, PayPal forward with allowlist and recording, instance gateway. Tests: T-PX-hooks (pass only for now), T-PX-forward (allowlist, recording), T-TR-redact, T-TR-evidence.
```

## Prompt 5 — Worker skeleton, instances, buyer, API (P1-8, P1-9, P1-10)

```text
Implement apps/worker: job loop, run state machine (docs/02 §4) with phases stubbed, instance manager (docs/04 F4, baseline instances only), engine.ts (proxy + worker in one process), and the scripted Playwright buyer using the approach recorded for S1 (selectors in one file). Implement apps/api routes for health, session, targets presets, runs create/get/events/stream (docs/09 §1).
Goal = Gate G1: one real sandbox purchase on a worker-started BuggyBeans instance with pc-, wh-, wf-, br-, st-, tr- items visible via the API. Add T-SBX-purchase.
```

## Prompt 6 — Attacks and verdicts (Phase 2)

```text
Implement docs/05 for A1, A3, A4, A5, A7: attack specs in @cct/core, invariants I1–I7 (table-driven tests), webhook rules (duplicate, hold/release, drop, forge), fault rules (timeout_after_forward, negative_test, latency, error_before_forward), settle + truth reader (docs/04 F9), findings, checklist mode. Then the web screens S2, S3, S4 (basic) from docs/11 using docs/design.md.
Goal = Gate G2 (docs/13). Add T-SBX-attacks and eval:bugs (offline + live) per docs/15 §6.
```

## Prompt 7 — Agent (Phase 3)

```text
Implement @cct/agent per docs/06: Ollama client (native /api/chat, mutex, retries, model_calls logging), TOOL_PROTOCOL native|json, recon with the suspect questions, planner loop with tools and budgets, diagnosis with evidence validation and category consistency, template fallbacks, degradation rules. Implement @cct/patch (parse, apply, guard per docs/12 §5), patched instances, verify re-run, reference-fix path. Build the injection variant and eval:agent (docs/15 §7). Then the finding page S5.
Goal = Gate G3. Report eval numbers honestly.
```

## Prompt 8 — Polish, report, deploy (Phase 4)

```text
Apply docs/design.md across all screens (docs/11), build the timeline swimlanes, evidence drawer, report page S6 with the real-vs-simulated section, and the pinned demo report. Write infra/render.yaml for cct-web, cct-api, cct-engine (1c-2g), buggybeans-public; document env per docs/03 §5. Write the README per docs/16 §5. Run demo:rehearse ×5 on hosted.
Goal = Gate G4.
```

## Prompt 9 — Should items (only if G4 is green early)

```text
In priority order, stop when time runs out: B2/A2, B6/A6, B8/A8; regression check of patches; Markdown/JSON report export; CLI; explore-mode buyer. Keep all Must tests green after each item.
```

## Prompt 10 — Submission support

```text
Generate the gallery screenshots listed in docs/19 §3 from the hosted app, fill the Devpost draft in docs/19 §2 with the latest eval numbers (with date and model ID), and run every check in docs/16 §4 and §5. List anything not ticked.
```

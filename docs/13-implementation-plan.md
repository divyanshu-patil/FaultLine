# 13. Implementation plan

Today: Mon 19 Oct 2026 (IST). Deadline: **Fri 13 Nov 2026 01:30 IST** (12 Nov 12:00 PT ✅). Target submission: **Wed 11 Nov 18:00 IST**. Thu 12 Nov is buffer only.

Assumption (judgement): one developer, ~8 focused hours/day with a coding agent. Hour estimates are ideal hours, labelled as judgement. If you have fewer hours, cut from the bottom of §2 first.

## 1. Scope (MoSCoW)

| Must | Should | Could | Won't (this hackathon) |
| --- | --- | --- | --- |
| BuggyBeans with B1, B3, B4, B5, B7 and fixed form | B2, B6, B8 and attacks A2, A6, A8 | A9 double submit | Production PayPal |
| Proxy: webhook ingress, record, correlate, pass/duplicate/forge/hold/drop | Explore-mode buyer for unknown stores | Jev/Laya scoring | Patching user repos / GitHub PRs |
| Fault proxy: timeout_after_forward, negative_test | External targets with ownership verification | BuggyBeans v6 variant | Authorize/void, refunds, subscriptions |
| Instance manager incl. patched instances | Regression check of patches against other attacks | KERNEL cloud browser; AG Grid trace explorer (AG Grid prize eligibility, `judging.md` §3) | Load testing |
| Scripted Playwright buyer + fallback FB1 | Markdown/JSON report export | CLI | Multi-user accounts |
| Attacks A1, A3, A4, A5, A7; invariants I1–I7 | CLI | Screenshot hints to the model | |
| Settle + truth reader | `reverify` endpoint | | |
| Checklist mode | | | |
| Agent: recon, planner, diagnosis, patch + guard + verify | | | |
| Live run view, finding page, public report | | | |
| Eval harness (offline + live) | | | |
| Hosted demo (Render + Supabase), README, video, Devpost | | | |

## 2. Phases, gates and tasks

### Phase 0 — Accounts and spikes (Mon 19 – Wed 21 Oct)

| ID | Task | Est. h | Done when |
| --- | --- | --- | --- |
| P0-1 | Create PayPal developer account, sandbox business + personal accounts, `faultline-buggybeans` REST app; Supabase project; Ollama Cloud key; Render account | 2 | credentials in a password manager; `.env` local |
| P0-2 | Spike S0: token, create order, capture via curl; record response shapes into `docs/07` | 2 | shapes pasted, marks updated |
| P0-3 | Spike S1: Playwright approves a sandbox order in the popup headless and headed; decide buyer approach | 4 | decision recorded in `docs/18` |
| P0-4 | Spike S2+S3: tunnel + webhook registration; observe real deliveries; replay one byte-for-byte and verify via postback | 3 | event names, order-id path, replay result recorded |
| P0-5 | Spike S4+S5: `PayPal-Request-Id` double capture; negative-testing codes on capture | 2 | observed responses recorded |
| P0-6 | Spike S6: Ollama `/api/tags`, exact Gemma 4 31B ID, 20 tool-call trials, 20 JSON trials, latency, limits | 3 | `OLLAMA_MODEL`, `TOOL_PROTOCOL` chosen |
| P0-7 | Spike S7+S9: Chromium + child instance in a Render `1c-2g` web service (hello-world engine) | 3 | memory/time numbers recorded |
| P0-8 | Spike S8: Supabase session pooler: SKIP LOCKED claim + LISTEN/NOTIFY from Node | 1 | works or alternative chosen |

**Gate G0 (Wed 21 Oct, 22:00 IST):** S1, S2, S6 must have a working path (including fallbacks). If S1 has no automated path at all, switch the hosted demo to FB1 (stored login state) and keep FB3 for local. If S6 fails (no usable Gemma 4 31B on Ollama Cloud), use the best tool-capable model available on Ollama Cloud and note the change (owner decision).

### Phase 1 — Foundations (Thu 22 – Mon 26 Oct)

| ID | Task | Est. h |
| --- | --- | --- |
| P1-1 | Turborepo scaffold, config package, CI skeleton (lint, typecheck, test, prod-host grep, gitleaks) | 3 |
| P1-2 | `@faultline/schemas` (probe, rules, attack spec, API DTOs, run events, agent contracts) | 4 |
| P1-3 | `@faultline/db`: Drizzle schema (all tables in `docs/08`), migrations, queue claim, notify | 5 |
| P1-4 | `apps/buggybeans` fixed form: catalog, orders, capture, webhooks with verification, probe, pages, checkout.js | 8 |
| P1-5 | BuggyBeans bug paths B1, B3, B4, B5, B7 + variant renderer | 5 |
| P1-6 | `@faultline/paypal` (allowlist, token cache, truth reads) + `@faultline/trace` (recorder, evidence IDs, redaction) | 5 |
| P1-7 | `apps/proxy`: hooks ingress + correlation + pass-through; PayPal forward with recording; instance gateway | 7 |
| P1-8 | `apps/worker`: job loop, run state machine skeleton, instance manager (baseline instances) | 6 |
| P1-9 | Scripted buyer (S1 outcome) | 4 |
| P1-10 | `apps/api`: health, session, targets (presets), runs create/get/events/stream | 6 |

**Gate G1 (Mon 26 Oct):** one real sandbox purchase on a FaultLine-started BuggyBeans instance, fully recorded (pc-, wh-, wf-, br-, st-, tr- items visible via API). (AC-13, AC-16, AC-20, AC-30)

### Phase 2 — Attacks and verdicts (Tue 27 Oct – Sun 1 Nov)

| ID | Task | Est. h |
| --- | --- | --- |
| P2-1 | `@faultline/core` attack specs A1, A3, A4, A5, A7 | 3 |
| P2-2 | Invariants I1–I7, table-driven tests | 5 |
| P2-3 | Webhook rules: duplicate, hold/release, drop, forge | 6 |
| P2-4 | Fault rules: timeout_after_forward, negative_test, latency, error_before_forward | 4 |
| P2-5 | Settle window + truth reader + findings | 4 |
| P2-6 | Checklist mode end to end | 3 |
| P2-7 | Web: login, new run, live run (basic phase stepper, timeline list, invariant board) | 8 |
| P2-8 | Eval harness offline (FakePayPal) + `eval:bugs` live for the Must matrix | 5 |

**Gate G2 (Sun 1 Nov):** checklist mode on `buggybeans:demo` fails exactly the expected invariants for A1, A3, A4, A5, A7 and `buggybeans:fixed` is all green, live in the sandbox, 3 times in a row. (AC-35..AC-41)

### Phase 3 — Agent (Mon 2 – Fri 6 Nov)

| ID | Task | Est. h |
| --- | --- | --- |
| P3-1 | `@faultline/agent` Ollama client, mutex, retries, model_calls logging, FakeOllama | 4 |
| P3-2 | Recon (excerpts, suspect questions, parsing, fallback) | 4 |
| P3-3 | Planner loop + tools + JSON/native protocols + budgets + degradation | 7 |
| P3-4 | Diagnosis + evidence validation + category check + template fallback | 5 |
| P3-5 | `@faultline/patch` parse/apply/guard; patched instance build/start | 6 |
| P3-6 | Verify re-run + reference fix path | 3 |
| P3-7 | Injection variant + agent eval (`eval:agent`) | 4 |
| P3-8 | Finding page (diagnosis, diff, proof cards) | 5 |

**Gate G3 (Fri 6 Nov):** agent mode on `buggybeans:demo` proves all 5 Must bugs within budget; ≥ 3 verified AI patches across 3 eval runs; evidence validity 100% after validation. If < 3 patches verify, the demo shows 1 strong AI patch + reference fixes (labelled) and the story stays honest. (AC-44..AC-58)

### Phase 4 — Product polish and hosting (Sat 7 – Mon 9 Nov)

| ID | Task | Est. h |
| --- | --- | --- |
| P4-1 | Apply `docs/design.md` across screens; timeline swimlanes; evidence drawer; responsive | 8 |
| P4-2 | Public report page + pinned demo report | 4 |
| P4-3 | Render Blueprint, Supabase prod project, webhook URL to hosted engine, access codes | 4 |
| P4-4 | README (setup, run, limitations, real vs simulated), LICENSE, architecture image | 3 |
| P4-5 | Should items if time: A2/A6/A8 (+B2/B6/B8), markdown export, CLI | 0–8 |
| P4-6 | `demo:rehearse` ×5 on hosted | 2 |

**Gate G4 (Mon 9 Nov, 22:00 IST):** hosted demo passes 5 rehearsals in a row; a fresh clone runs locally from the README; checks in `docs/16` §4 all ticked.

### Phase 5 — Submission (Tue 10 – Wed 11 Nov)

| ID | Task | Est. h |
| --- | --- | --- |
| P5-1 | Record and edit the < 3 min video (`docs/19`), upload public to YouTube | 5 |
| P5-2 | Devpost text, images, testing instructions with access code | 3 |
| P5-3 | Final checks (`docs/16` §5); submit **Wed 11 Nov 18:00 IST** | 2 |

Thu 12 Nov: buffer only (fix submission issues). Nothing new is built.

### After submission (judging 1–15 Dec ✅)

- 28–30 Nov: move engine, api, web to paid instances; confirm Supabase not paused; re-run rehearsal; refresh FB1 login state if used.
- 1–15 Dec: daily health check and one rehearsal run; keep the pinned report.
- Do not change the submitted repo's behaviour during judging beyond critical fixes (rules may treat changes after the deadline as out of bounds ❓ — check the rules before pushing).

## 3. Totals (judgement)

Must ≈ 180 h; Should ≈ +25 h. At 8 h/day × 23 working days ≈ 184 h, the plan fits Must with little slack, so Should items are strictly time-permitting. Cut order if behind: P4-5 → explore buyer → regression check → A7 (keep A1, A3, A4, A5) → patch attempts to 1.

## 4. Critical path

S1 (buyer approval) → P1-9 → G1 → P2-3/P2-4 → G2 → P3-5 (patched instances) → G3 → P4-3 (hosting) → G4 → video.

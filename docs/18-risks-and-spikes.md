# 18. Risks and Day-0 spikes

## 1. Spikes (Mon 19 – Wed 21 Oct)

Each spike has a question, a method, a pass condition, and a fallback. Record outcomes in §3 with the date, and update `docs/07` / `docs/06` marks.

| ID | Question | Method | Pass | Fallback |
| --- | --- | --- | --- | --- |
| S0 | Do token, create, capture, get order work with our sandbox app; what are the exact response shapes? | curl / tiny script | shapes recorded | — (blocking) |
| S1 | Can Playwright approve an order in the PayPal sandbox popup, headless, reliably (10/10)? | script on a minimal page with JS SDK buttons | ≥ 9/10 headless | FB1 stored login state; FB2 guest card in popup ⚠️; FB3 assisted approval (local only) |
| S2 | Which events arrive for a purchase, in what order and timing; where is the order ID in capture events? | real purchases through a tunnel to a logging endpoint | event list + field path recorded | correlate by capture ID via `paypal_calls` responses |
| S3 | Does a byte-for-byte replay of a real delivery pass `verify-webhook-signature` again? Does PayPal check transmission time? | replay recorded delivery to verify endpoint after 1 min and 1 h | SUCCESS both | A1 still valid (fixed store dedupes by event id regardless); document "replay re-verifies: no" and have the fixed store treat verification failure on duplicates as ignorable |
| S4 | Does Orders v2 capture honour `PayPal-Request-Id`? What does a second capture (same ID / new ID) return? | two captures on one approved order | responses recorded | fixed store reconciles with GET order instead of relying on the header |
| S5 | Which `mock_application_codes` work on capture in our app (e.g. `INSTRUMENT_DECLINED`)? Is any account setting needed? | negative-testing header on capture | at least one decline-type code works | A7 uses `error_before_forward 422` with PayPal-shaped body, labelled synthetic |
| S6 | Ollama Cloud: exact Gemma 4 31B ID; tool-call reliability (20 trials); JSON reliability (20 trials); `format` support; latency p50/p95; free-tier limits | scripts against `/api/chat` | ≥ 18/20 valid in the chosen protocol; p95 < 30 s | JSON protocol + repair; if Gemma 4 31B unavailable, owner picks another Ollama Cloud tool model |
| S7 | Chromium + 2 BuggyBeans instances fit in Render `1c-2g`? Native runtime or Docker needed? | hello-world engine deploy | runs a scripted purchase on Render | Docker runtime; or KERNEL cloud browser (Could) |
| S8 | Supabase session pooler supports SKIP LOCKED claim and LISTEN/NOTIFY from Node `pg` | small script | both work | polling for SSE; direct connection (IPv6) |
| S9 | Time to copy, patch, type-check, build and start a patched BuggyBeans on the engine | script | < 60 s | skip `tsc`, rely on `tsup` + runtime smoke; or prebuild with esbuild only |
| S10 | (Could) Jev / Laya access, latency and accuracy on Q1–Q8 for the seeded variants | API calls | access works | leave `CLASSIFIER_PROVIDER=none` |
| S11 | (Should) Is there an official PayPal standard-checkout sample app we can run as a second target? | search PayPal GitHub ⚠️ | runs locally with our probe adapter | skip; mention as future work |

## 2. Risk register

Likelihood and impact are the author's judgement (H/M/L).

| ID | Risk | L | I | Mitigation | Owner trigger |
| --- | --- | --- | --- | --- | --- |
| R1 | PayPal popup blocks automation | M | H | S1 early; FB1–FB3 | S1 < 9/10 |
| R2 | Webhook replay fails verification, weakening A1 realism | M | M | S3; dedupe logic independent of verification | S3 result |
| R3 | Negative testing codes don't work on capture | L | M | S5; labelled synthetic fallback | S5 result |
| R4 | Gemma 4 31B unreliable at tools/JSON | M | H | JSON protocol + repair + templates; checklist mode | S6 < 18/20 |
| R5 | Ollama rate/concurrency limits slow runs | M | M | serialise; budgets; cache recon per variant | p95 > 30 s |
| R6 | Engine OOM / slow on Render | M | H | S7; plan size; `MAX_LIVE_INSTANCES=2` | S7 |
| R7 | AI patches rarely verify | M | M | tight prompt with exact file content; 2 attempts; reference fix labelled; aim ≥ 1 (AC-57) | G3 |
| R8 | Scope too large for one developer | H | H | MoSCoW; cut list in `docs/13` §3; gates | slip > 1 day at any gate |
| R9 | Judges see it as "not agentic commerce" | M | M | frame as agentic AI on PayPal rails; target Best Use of PayPal + AI and Grand Prize, not the agentic-commerce HM (`judging.md`) | — |
| R10 | Similar entries exist | M | M | rival check before submission (gallery published after deadline ❓); strong evidence-backed demo | — |
| R11 | Hosted demo down during judging | M | H | paid instances; daily checks; pinned report; video carries the story | — |
| R12 | Supabase project pauses | L | H | 6-hourly ping; check before judging | — |
| R13 | Secrets leak via traces/reports | L | H | redaction tests; report scan; gitleaks | — |
| R14 | Prompt injection via store code | L | M | untrusted tags; closed tools; AC-48 | — |
| R15 | PayPal sandbox outage on demo day | L | H | pinned report and video; rehearse early | — |
| R16 | Laya/Jev costs after 31 Oct | L | L | off by default | — |
| R17 | Flaky sandbox UI makes evals noisy | M | M | retry buyer once on infra errors; report infra errors separately from findings | — |

## 3. Go/no-go record

| Date | Gate / spike | Result | Decision |
| --- | --- | --- | --- |
| 2026-10-19 | S0 | Token ✅ (`expires_in` 32399, `app_id` returned). Create order `201 {id, status:"CREATED", links[rel=approve → www.sandbox.paypal.com/checkoutnow?token=<id>]}` ✅. GET order shows `payee.merchant_id`. Capture on an unapproved order → `422 ORDER_NOT_APPROVED` ✅ | shapes recorded in `docs/07` |
| 2026-10-19 | S1 | Not run: only the sandbox buyer **email** is available, not the password. Card approval (`confirm-payment-source` with sandbox cards) → `422 PAYER_CANNOT_PAY`; card in create → `422 PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` (business account lacks ACDC) | buyer approval is pluggable (`BUYER_APPROVAL=login|card|assisted|fake`); `login` needs `SANDBOX_BUYER_PASSWORD`; `card` needs ACDC enabled on the sandbox app; `assisted` (FB3) works with no extra secret |
| | S2 | pending (needs tunnel + approved order) | |
| | S3 | pending | fixed store dedupes by event id regardless of verification |
| | S4 | pending (needs an approved order) | fixed store also reconciles via GET order |
| 2026-10-19 | S5 | `PayPal-Mock-Response: {"mock_application_codes":"INSTRUMENT_DECLINED"}` on capture → real `422 {details[0].issue:"INSTRUMENT_DECLINED"}` ✅, even before approval; order stays `CREATED` | A7 uses real negative testing |
| 2026-10-19 | S6 | `/api/tags` lists `gemma4:31b` ✅. Native tool calls 5/5 valid, JSON-object protocol 5/5 valid (often wrapped in ```json fences), `format:"json"` not honoured (0/5). Latency p50 ≈ 1.6 s, max 2.1 s. `prompt_eval_count`/`eval_count` present on native replies | `OLLAMA_MODEL=gemma4:31b`, `TOOL_PROTOCOL=native` (json supported as fallback), no `format` |
| 2026-10-19 | S8 | Local Postgres 15 available; Supabase deferred by owner | plain `pg`; SSE polls `run_events` (no LISTEN/NOTIFY dependency) |
| 2026-10-19 | S9 | Node 24.10 strips TypeScript natively (workspace symlinks included); `node:sqlite` built in | services and patched BuggyBeans run from `.ts` source, no `tsup` build |
| | G0 (21 Oct) | | |
| | G1 (26 Oct) | | |
| | G2 (1 Nov) | | |
| | G3 (6 Nov) | | |
| | G4 (9 Nov) | | |

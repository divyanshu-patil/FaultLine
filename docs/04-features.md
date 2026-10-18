# 04. Features — how each one works

Each feature lists: purpose, how it works step by step, inputs/outputs, failure handling, priority (MoSCoW), and the acceptance criteria (`docs/14`) and tests (`docs/15`) that cover it.

| ID | Feature | Priority |
| --- | --- | --- |
| F1 | Access and session | Must |
| F2 | Targets | Must (BuggyBeans) / Should (external) |
| F3 | Run creation and modes | Must |
| F4 | Instance manager | Must |
| F5 | Buyer agent (Playwright) | Must (scripted) / Should (explore) |
| F6 | Webhook chaos proxy | Must |
| F7 | API fault proxy | Must |
| F8 | Trace recorder and evidence IDs | Must |
| F9 | Settle window and truth reader | Must |
| F10 | Invariant engine | Must |
| F11 | Recon (code reading and suspects) | Must (LLM) / Could (Jev/Laya) |
| F12 | Agent planner loop | Must |
| F13 | Diagnosis | Must |
| F14 | Patch, guard and verify re-run | Must (≥1 bug) / Should (all) |
| F15 | Live run view | Must |
| F16 | Reports and export | Must (page) / Should (Markdown/JSON) |
| F17 | Eval harness | Must |
| F18 | CLI | Should |

---

## F1. Access and session

**Purpose:** keep the hosted demo usable by judges without accounts, and stop strangers from burning the Ollama and PayPal budget.

**How it works**
1. `/login` asks for an access code. Codes come from `ACCESS_CODES`. The Devpost testing instructions give judges one code.
2. `POST /api/session {code}` compares in constant time, then sets an httpOnly, `SameSite=Lax`, `Secure` cookie `fl_session` (signed, 12 h). The browser reaches the API through the Next.js same-origin rewrite (ADR-015), so the cookie is first-party.
3. Every `/api/*` route except `/api/health`, `/api/session` and `GET /api/reports/:slug` requires the cookie.
4. Rate limits: 5 login attempts / 10 min / IP; 6 runs / hour / session; 1 active run per session.

**Failures:** wrong code → 401 `INVALID_CODE`; rate limit → 429 with `Retry-After`.

**Covered by:** AC-01..AC-03; tests T-API-session.

## F2. Targets

**Purpose:** define what FaultLine may attack.

**How it works**
- **Built-in targets** (seeded): `buggybeans:demo` (bugs B1, B3, B4, B5, B7), `buggybeans:all` (B1–B8), `buggybeans:fixed` (none), `buggybeans:custom` (user picks bugs). Hosted mode allows only these.
- **External targets** (self-host only, `ALLOW_EXTERNAL_TARGETS=true`), Should:
  1. User enters base URL, webhook path, probe path, and the source folder path for recon (local path or uploaded zip).
  2. FaultLine issues a verification token. The user serves it at `<baseUrl>/.well-known/faultline-verify.txt`.
  3. `POST /api/targets/:id/verify` fetches the token; on match the target is `verified`.
  4. The user configures their store per the target contract: `PAYPAL_API_BASE` → engine proxy URL, webhook URL on their sandbox app → engine `/hooks/paypal`, probe endpoint implemented.
  5. Hosts resolving to private IP ranges are refused unless `FAULTLINE_MODE=selfhost` and the host is `localhost` (SSRF guard).

**Outputs:** `targets` row with `kind`, `status`, `bugs`, `contract` JSON.

**Covered by:** AC-04..AC-07; T-API-targets, T-SEC-ssrf.

## F3. Run creation and modes

**Purpose:** start a crash test.

**How it works**
1. `POST /api/runs {targetId, mode: "agent"|"checklist", attacks?: AttackId[], budget?: Partial<Budget>}`.
2. API validates: target allowed and verified; one active run per session; budget within caps.
3. Inserts `runs` (status `queued`) and a `jobs` row (`kind: run`). Returns `202 {runId}`.
4. **Checklist mode:** the executor runs the selected attacks (default: all Must attacks) in catalog order, then reports. No model calls.
5. **Agent mode:** the agent loop (F12) chooses attacks, diagnoses and patches within the budget.
6. If Ollama fails at the start (health probe or 2 consecutive call failures), an agent run **degrades** to checklist mode, records `run_events.kind = degraded`, and shows a banner.
7. `POST /api/runs/:id/cancel` marks the run cancelled; the worker stops at the next safe point (between steps) and stops instances.

**Covered by:** AC-08..AC-12; T-API-runs, T-WK-state-machine.

## F4. Instance manager

**Purpose:** give every attack and every patch verification a clean store.

**How it works**
1. `startInstance({bugs, patch?})` picks a free port from `INSTANCE_PORT_RANGE`, creates `SQLITE_PATH=/tmp/faultline/<instanceId>.db`, and spawns `node apps/buggybeans/dist/server.js` with env (`docs/03` §5).
2. Waits for `GET /healthz` (timeout 15 s), then for `GET /__crashtest/state` with the probe token.
3. Registers `instance_id → 127.0.0.1:<port>` in the proxy's instance table so `https://<engine>/i/<instanceId>/…` works.
4. **Patched instance:** copies the **rendered variant source** (`docs/10` §6, the same source the model saw) to `/tmp/faultline/src-<instanceId>/`, applies the diff (F14), runs `tsc --noEmit` (60 s cap) and `tsup` (60 s cap), then starts it as above.
5. `stopInstance` kills the process (SIGTERM, then SIGKILL after 5 s), deletes the temp dir and DB file, unregisters the route.
6. Limits: `MAX_LIVE_INSTANCES`; idle instances stopped after 10 min by the `cleanup` job.

**Failures:** start timeout → attack marked `infra_error` (not a finding); build failure of a patch → patch `rejected: build_failed` with compiler output stored.

**Covered by:** AC-13..AC-15; T-WK-instances.

## F5. Buyer agent (Playwright)

**Purpose:** make a real sandbox purchase like a human would.

**Scripted mode (Must)** for BuggyBeans:
1. Open `PUBLIC_URL/` → product page → choose product and quantity.
2. Optional tamper (A5): `page.route('**/api/orders', …)` rewrites the JSON body `amount` before it reaches the store.
3. Click the PayPal button; capture the popup (`context.waitForEvent('page')`).
4. In the popup: log in with `SANDBOX_BUYER_EMAIL` / `SANDBOX_BUYER_PASSWORD`; click the pay/continue button. Selectors are kept in one file and confirmed in spike S1.
5. Wait for the store's confirmation page or error banner; record every step as a `browser_steps` trace item with a screenshot (JPEG, 60% quality).
6. Double-submit (A6 variant / A9): click the confirm button twice within 50 ms.

**Approval fallbacks if S1 fails** (decided on Day 0, recorded in `docs/18`):
- F5-FB1: use a persisted, logged-in sandbox buyer `storageState` created once by a human and stored as an encrypted secret file; refresh weekly.
- F5-FB2: pay with a sandbox test card through PayPal's guest card form in the popup ⚠️.
- F5-FB3 (last resort, labelled in UI): "assisted approval": the run pauses and a human approves in a visible browser (local only). The rest stays automated.

**Explore mode (Should)** for unfamiliar stores: the agent receives an accessibility snapshot (role, name, ref) of the page and chooses `click(ref)`, `fill(ref, text)`, `select(ref, value)` actions toward the goal "buy one item with PayPal". Max 25 actions. The PayPal popup itself always uses the scripted sub-flow.

**Covered by:** AC-16..AC-19; T-WK-buyer (fake store), T-SBX-purchase (live).

## F6. Webhook chaos proxy

**Purpose:** deliver PayPal's real webhooks to the store the way production can: twice, late, out of order, never, or forged.

**How it works**
1. `POST /hooks/paypal` (PayPal → engine): read raw body (limit 1 MB), store `webhook_deliveries` (body bytes, five `PAYPAL-*` headers, event id, event type, resource ids), answer `200` immediately.
2. Correlate (architecture §6). If no run owns the order, keep it `uncorrelated`.
3. Look up the run's active webhook rules and act:

| Rule | Behaviour |
| --- | --- |
| `pass` | forward once, immediately |
| `duplicate {times, gapMs}` | forward the same bytes and headers `times` times |
| `delay {ms}` | hold, then forward |
| `hold_until {eventType}` / `release_order [...]` | hold events and release them in a chosen order (out-of-order attack) |
| `drop` | never forward (store relies on webhooks alone? A8) |
| `forge {template, mutate}` | send a synthetic event for an order PayPal never created, with fake signature headers |

4. Each forward is recorded in `webhook_forwards` (target status code, latency, response body first 2 KB).
5. Replays only ever use deliveries already received from PayPal, for the same run.

**Failures:** store returns non-2xx → recorded; the proxy does not retry unless the rule says so. Proxy restart → held deliveries are persisted and resumed.

**Covered by:** AC-20..AC-25; T-PX-hooks.

## F7. API fault proxy

**Purpose:** reproduce network failures between the store and PayPal, and PayPal-side errors, on demand.

**How it works**
1. Store calls `https://<engine>/paypal/<instanceId>/v2/checkout/orders/...`.
2. Proxy validates the path against the allowlist (`/v1/oauth2/token`, `/v2/checkout/orders`, `/v2/checkout/orders/{id}`, `/v2/checkout/orders/{id}/capture`, `/v1/notifications/verify-webhook-signature`); anything else → `403 UPSTREAM_PATH_NOT_ALLOWED`.
3. Applies the run's fault rule matching `method + pathPattern + occurrence`:

| Fault | Behaviour | Real or synthetic |
| --- | --- | --- |
| `timeout_after_forward {ms}` | forward to PayPal, record PayPal's real response, then hang `ms` and return `504` to the store | PayPal action real; store-side failure synthetic |
| `error_before_forward {status}` | return `status` without calling PayPal | synthetic, labelled |
| `negative_test {code}` | add `PayPal-Mock-Response: {"mock_application_codes":"<code>"}` and forward | PayPal returns a real error ✅ |
| `latency {ms}` | wait, then forward | real |

4. Records every call in `paypal_calls` (method, path, status, request body, response body, headers minus secrets, `paypal_request_id` if present, `fault_applied`).

**Covered by:** AC-26..AC-29; T-PX-forward.

## F8. Trace recorder and evidence IDs

**Purpose:** everything the AI says must point to something real.

**How it works**
- Every recorded item gets a short **evidence ID** with a typed prefix, unique within the run:

| Prefix | Item | Example |
| --- | --- | --- |
| `pc-` | PayPal API call through the proxy | `pc-0007` |
| `wh-` | webhook delivery received from PayPal | `wh-0003` |
| `wf-` | webhook forward to the store | `wf-0005` |
| `br-` | browser step | `br-0012` |
| `st-` | state probe snapshot | `st-0002` |
| `tr-` | truth read from PayPal by the worker | `tr-0001` |
| `iv-` | invariant result | `iv-0004` |
| `src-` | source file excerpt shown to the model (`src-webhooks.ts#L10-42`) | |

- `validateEvidenceRefs(output, runId)` checks that every ID in a model output exists in the run's trace; otherwise the output is rejected (F13).
- Redaction (`@faultline/trace/redact`): `Authorization`, `client_secret`, `access_token`, `password`, cookie values, `PAYPAL-TRANSMISSION-SIG` (kept as hash) are replaced with `[redacted]` before storage.

**Covered by:** AC-30..AC-32; T-TR-redact, T-TR-evidence.

## F9. Settle window and truth reader

**Purpose:** decide when an attack is "over" and what really happened at PayPal.

**How it works**
1. After the buyer finishes (or fails), wait until all are true or `SETTLE_SECONDS` (default 60) passes: expected webhook deliveries received (per attack spec), held deliveries released, the probe snapshot unchanged for 5 s.
2. Truth read: `GET /v2/checkout/orders/{id}` for every order the run created (direct to sandbox with FaultLine's own token, not via the fault proxy). Store `truth_reads` with status, purchase units, captures (id, status, amount).
3. Final probe snapshot.

**Covered by:** AC-33..AC-34; T-WK-settle.

## F10. Invariant engine

**Purpose:** the deterministic judge.

**How it works:** pure functions in `@faultline/core/invariants` take `{truth, before, after, deliveries, forwards, calls, catalog}` and return `{id, status: pass|fail|not_applicable, expected, actual, evidence: EvidenceId[]}`. Definitions I1–I7 are in `docs/05-attack-catalog.md` §2. Each attack declares which invariants it checks. A failed invariant creates a `findings` row.

**Covered by:** AC-35..AC-41; T-CORE-invariants (table-driven).

## F11. Recon

**Purpose:** let the agent suspect bugs before spending attacks.

**How it works**
1. Load target source: for BuggyBeans, the **rendered variant source** with inactive bug branches removed (`docs/10` §6), allowlisted files only ( `routes/orders.ts`, `routes/webhooks.ts`, `routes/account.ts`, `db.ts`, `public/checkout.js`). Files are cut into excerpts ≤ 200 lines with `src-` IDs.
2. Ask the model the fixed **suspect questions** (`docs/06` §6) in one call; the output is `{suspects:[{question_id, likely: boolean, confidence: 0..1, evidence: src-IDs, reason}]}`.
3. Could: if `CLASSIFIER_PROVIDER` is `jev` or `laya`, ask the same yes/no questions there too and store both scores; the planner sees both.
4. **The secret bug list (`BUGS`) is never shown to the model.** Recon reads code only, like it would for an external store.

**Covered by:** AC-42..AC-43; T-AG-recon (fake model).

## F12. Agent planner loop

**Purpose:** decide what to try next.

**How it works:** a tool-calling loop over Gemma 4 31B with the tools in `docs/06` §4. Each step: send goal, budget left, suspects, attack history with verdicts, and open findings; receive exactly one tool call; validate args; execute; append result; repeat. Stops on `finish`, budget exhaustion, cancel, or 3 consecutive invalid outputs (then degrades to checklist for the remaining Must attacks).

**Covered by:** AC-44..AC-48; T-AG-loop.

## F13. Diagnosis

**Purpose:** explain a finding from evidence.

**How it works**
1. Input: the failed invariant(s), the attack spec, trace items (summarised and capped at ~12k tokens), and relevant source excerpts.
2. Output contract (zod): `{finding_id, category, root_cause, mechanism_steps[], evidence: EvidenceId[] (≥ 2), affected_files[], confidence, unknowns[]}`; categories: `missing_dedupe`, `ordering`, `no_signature_check`, `capture_retry`, `client_amount_trusted`, `fulfil_without_capture`, `decline_handled_as_success`, `webhook_only_fulfilment`, `other`.
3. Checks: JSON parse → zod → `validateEvidenceRefs` → category must be consistent with the failed invariant (table in `docs/05` §4). One repair attempt with the errors. If still invalid → **template diagnosis** from the attack spec, labelled "template".

**Covered by:** AC-49..AC-52; T-AG-diagnose.

## F14. Patch, guard and verify re-run

**Purpose:** prove a fix, not just suggest one.

**How it works**
1. Model returns a unified diff limited to `affected_files` plus `db.ts` (for a unique index).
2. **Patch guard** (`@faultline/patch/guard`): diff parses; only allowlisted files; ≤ 120 changed lines; no new imports outside an allowlist (`express`, `better-sqlite3`, `zod`, `node:crypto`); forbidden tokens (`child_process`, `process.env` writes, `fs.rm`, `eval`, `Function(`, `net`, `http.request` to non-PayPal hosts, `BUGS`); must not disable the probe.
3. Pass → patched instance (F4) → re-run **the same attack** with the same rules → invariants.
4. Result `verified` (all checked invariants pass), `not_fixed` (still failing; next attempt with the new trace, max `AGENT_MAX_PATCH_ATTEMPTS` = 2), or `rejected` (guard/build).
5. Regression check (Should): run the other Must attacks on the patched instance; any new failure marks the patch `regressed`.
6. If no AI patch verifies, show the **reference fix** (BuggyBeans with that bug disabled) re-run result, labelled "reference fix (not AI-generated)".

**Covered by:** AC-53..AC-58; T-PATCH-guard, T-WK-verify.

## F15. Live run view

**Purpose:** let a viewer watch the agent think and act.

**How it works:** SSE stream (architecture §11) of `run_events`: phase changes, agent steps (tool name, short rationale), attack started/finished, invariant verdicts, findings, patch status. The page shows: phase stepper, agent log, attack timeline (swimlanes: Browser, Store, Proxy, PayPal), invariant board, findings list. Reconnects with `Last-Event-ID`.

**Covered by:** AC-59..AC-61; T-WEB-run-view.

## F16. Reports and export

**Purpose:** something to share and something judges can read without running anything.

**How it works:** on completion, the worker writes `reports` with a random 16-char `slug`. `GET /api/reports/:slug` (public, read-only) returns findings, evidence excerpts (redacted), diagnosis, patch diff, before/after verdicts, model and budget used, and a "what was simulated" section. Export as Markdown (`?format=md`) and JSON (Should). Reports never contain secrets or sandbox buyer credentials.

**Covered by:** AC-62..AC-64; T-API-reports, T-SEC-report-redaction.

## F17. Eval harness

**Purpose:** turn claims into numbers.

**How it works:** `pnpm eval:bugs` runs a matrix of BuggyBeans configs (each single bug, the demo set, all, none) in checklist and agent modes; writes `eval/results/<date>.json` and a Markdown summary: detection per bug, false positives, attacks used, diagnosis category accuracy, evidence validity rate, patch verified rate, wall time, tokens. Offline variant uses FakePayPal and FakeOllama (CI); live variant uses the sandbox and the real model.

**Covered by:** AC-65..AC-66; `docs/15` §6.

## F18. CLI (Should)

`faultline run --target buggybeans:demo --mode agent --wait`, `faultline report <runId> --md > report.md`, `faultline eval`. Talks to `apps/api` with an access code from `FAULTLINE_ACCESS_CODE`.

**Covered by:** AC-67.

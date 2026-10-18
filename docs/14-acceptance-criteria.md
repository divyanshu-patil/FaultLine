# 14. Acceptance criteria

Format: **ID — Given / When / Then** · priority · test reference (`docs/15`). A feature is done when all its Must criteria pass.

## F1 Access and session
- **AC-01** — Given a valid access code, when `POST /api/session`, then `204` and an httpOnly signed cookie is set; `GET /api/me` returns the session. · Must · T-API-session
- **AC-02** — Given no cookie, when calling any protected route, then `401 UNAUTHENTICATED`. Public: `/api/health`, `/api/session`, `GET /api/reports/:slug`. · Must · T-API-session
- **AC-03** — Given 5 wrong codes from one IP in 10 min, when a 6th is sent, then `429` with `Retry-After`. · Must · T-API-session

## F2 Targets
- **AC-04** — Given hosted mode, when listing targets, then only BuggyBeans presets appear, and `bugs` is not included for presets. · Must · T-API-targets
- **AC-05** — Given hosted mode, when `POST /api/targets` (external), then `403 TARGET_NOT_ALLOWED`. · Must · T-API-targets
- **AC-06** — Given selfhost mode and a target serving the right token, when verify is called, then status becomes `verified`; with a wrong token, `409`. · Should · T-API-targets
- **AC-07** — Given a target URL resolving to a private IP (not `localhost` in selfhost), when created or verified, then it is refused. · Should · T-SEC-ssrf

## F3 Runs
- **AC-08** — Given a session without an active run, when `POST /api/runs` with a valid target, then `202 {runId}`, a `runs` row `queued` and a `jobs` row exist. · Must · T-API-runs
- **AC-09** — Given an active run in the session, when another is created, then `409 RUN_ALREADY_ACTIVE`. · Must · T-API-runs
- **AC-10** — Given checklist mode, when the run completes, then zero `model_calls` rows exist for the run. · Must · T-WK-state-machine
- **AC-11** — Given agent mode and an Ollama health failure at start, when the run proceeds, then `effective_mode = checklist`, a `degraded` event exists and the UI shows the banner. · Must · T-WK-state-machine, T-WEB-run-view
- **AC-12** — Given a running run, when cancelled, then within 30 s the status is `cancelled` and all its instances are stopped. · Must · T-WK-state-machine

## F4 Instances
- **AC-13** — Given a run starts, when the instance manager starts a baseline instance, then `/healthz` and the probe respond within 15 s and the instance is reachable at `/i/<id>/`. · Must · T-WK-instances
- **AC-14** — Given a patch that does not compile, when a patched instance is requested, then patch status is `build_failed` with compiler output, and no process is left running. · Must · T-WK-instances
- **AC-15** — Given an instance's env, when inspected, then it contains none of `DATABASE_URL`, `OLLAMA_API_KEY`, `SESSION_SECRET`, `SANDBOX_BUYER_PASSWORD`. · Must · T-SEC-instance-env

## F5 Buyer
- **AC-16** — Given a BuggyBeans instance, when the scripted buyer buys `house-blend` ×1 and approves, then PayPal truth shows capture `COMPLETED` for 12.00 USD and `br-` steps (with screenshots after login) are recorded. · Must · T-SBX-purchase
- **AC-17** — Given `tamper amount=0.01`, when the buyer runs, then the store's `POST /api/orders` request body recorded in the trace shows `amount: "0.01"`. · Must · T-WK-buyer
- **AC-18** — Given `approve: false`, when the buyer runs, then the popup is closed without approval and PayPal truth shows `CREATED`. · Must · T-SBX-purchase
- **AC-19** — Given an unfamiliar store (BuggyBeans with changed markup), when explore mode runs, then it reaches the PayPal popup within 25 actions. · Should · T-AG-explore

## F6 Webhook chaos proxy
- **AC-20** — Given a PayPal delivery, when it reaches `/hooks/paypal`, then the proxy answers `200` within 1 s and stores the exact raw bytes and the five `PAYPAL-*` headers. · Must · T-PX-hooks
- **AC-21** — Given a delivery for an order created by a run's instance, when stored, then it is correlated to that run and instance. Uncorrelated deliveries are stored and not forwarded. · Must · T-PX-hooks
- **AC-22** — Given rule `duplicate {times:3}`, when the matching delivery arrives, then exactly 3 forwards with identical bytes and headers are recorded. · Must · T-PX-hooks
- **AC-23** — Given rules hold APPROVED / release after COMPLETED, when both arrive, then forwards occur in the order COMPLETED, APPROVED. · Should · T-PX-hooks
- **AC-24** — Given rule `forge`, when executed, then the forged delivery is marked `forged=true`, its order ID matches the run's abandoned order, and the UI labels it "forged by CCT". · Must · T-PX-hooks, T-WEB-run-view
- **AC-25** — Given rule `drop`, when deliveries arrive, then no forwards are recorded and the deliveries are still stored. · Should · T-PX-hooks

## F7 Fault proxy
- **AC-26** — Given an upstream path not in the allowlist, when forwarded, then `403 UPSTREAM_PATH_NOT_ALLOWED` and no upstream call. · Must · T-PX-forward
- **AC-27** — Given `timeout_after_forward` on the first capture, when the store captures, then PayPal's real `201` response is recorded and the store receives `504`. · Must · T-PX-forward, T-SBX-attacks
- **AC-28** — Given `negative_test {code}`, when the store captures, then the upstream request carries `PayPal-Mock-Response` with that code and the recorded response is PayPal's error. · Must · T-PX-forward, T-SBX-attacks
- **AC-29** — Given any recorded call, then `Authorization`, `client_secret` and `access_token` values are redacted. · Must · T-TR-redact

## F8 Trace
- **AC-30** — Given an attack run, when complete, then every trace item has a unique evidence ID with the correct prefix. · Must · T-TR-evidence
- **AC-31** — Given a model output citing an ID not in the run's trace, when validated, then it is rejected. · Must · T-TR-evidence
- **AC-32** — Given a stored webhook body, when shown in the UI or report, then the signature header is hashed. · Must · T-SEC-report-redaction

## F9 Settle and truth
- **AC-33** — Given an attack, when the buyer finishes, then invariants run only after expected deliveries arrived and the probe was stable for 5 s, or after 60 s with a `settle_timeout` note. · Must · T-WK-settle
- **AC-34** — Given an attack, when truth is read, then the call goes directly to the sandbox (not through the fault proxy) and is recorded as `tr-`. · Must · T-WK-settle

## F10 Invariants
- **AC-35** — I1..I7 each have table-driven tests with ≥ 3 passing and ≥ 3 failing fixtures. · Must · T-CORE-invariants
- **AC-36** — Given A1 on B1, then I2 fails with expected `100`, actual `≥ 200`. · Must · T-SBX-attacks
- **AC-37** — Given A3 on B3, then I5 fails; on the fixed store, the store answered `400` to the forged delivery. · Must · T-SBX-attacks
- **AC-38** — Given A4 on B4, then I4 and I6 fail; on the fixed store all pass and credits = 100. · Must · T-SBX-attacks
- **AC-39** — Given A5 on B5, then I3 fails with captured `0.01` vs expected `12.00`. · Must · T-SBX-attacks
- **AC-40** — Given A7 on B7, then I7 fails; on the fixed store the buyer sees the declined message. · Must · T-SBX-attacks
- **AC-41** — The expected results matrix in `docs/05` §5 holds for all Must attacks (live) and all attacks (offline). · Must · eval:bugs

## F11 Recon
- **AC-42** — Given recon, then the model receives rendered variant source only (no `bugs.` references, no `BUGS` value). · Must · T-AG-recon
- **AC-43** — Given an invalid recon output twice, then suspects default to all-likely 0.5 and the run continues. · Must · T-AG-recon

## F12 Planner
- **AC-44** — Given a planner reply with an unknown tool or invalid args, then it is recorded `valid=false` and not executed. · Must · T-AG-loop
- **AC-45** — Given 3 consecutive invalid replies, then planning stops and remaining Must attacks run in catalog order. · Must · T-AG-loop
- **AC-46** — Given budgets, when any reaches zero, then the loop stops, and attacks never run are reported "not run". · Must · T-AG-loop
- **AC-47** — Given `buggybeans:demo` live, when agent mode runs, then all 5 Must bugs produce findings within default budgets in ≥ 2 of 3 runs. · Must · eval:agent
- **AC-48** — Given the injection variant with B1, when agent mode runs, then A1 still runs and B1 is still found. · Must · eval:agent

## F13 Diagnosis
- **AC-49** — Every accepted diagnosis has ≥ 2 evidence IDs, all present in the trace. · Must · T-AG-diagnose
- **AC-50** — A diagnosis whose category is not allowed for its failed invariants is rejected (then repaired or templated). · Must · T-AG-diagnose
- **AC-51** — Template diagnoses are labelled "Template explanation" in UI and report. · Must · T-WEB-finding
- **AC-52** — Category accuracy ≥ 80% across eval runs for Must bugs (judgement target; reported as measured). · Should · eval:agent

## F14 Patch and verify
- **AC-53** — Patch guard rejects each forbidden pattern in `docs/12` §5 (one test per rule). · Must · T-PATCH-guard
- **AC-54** — A verified patch means the **same attack spec** re-ran on a fresh patched instance and every invariant of that attack passed. · Must · T-WK-verify
- **AC-55** — Given a patch that does not fix the bug, then status `not_fixed` and, if attempts remain, a second attempt includes the new verdicts. · Must · T-WK-verify
- **AC-56** — Given no verified AI patch, then the reference fix re-run is shown and labelled "Reference fix (not AI-generated)". · Must · T-WEB-finding
- **AC-57** — At least one Must bug is fixed by a verified AI patch in the demo run. · Must · eval:agent
- **AC-58** — Given regression check on, a verified patch that makes another Must attack fail is marked `regressed`. · Should · T-WK-verify

## F15 Live view
- **AC-59** — Given a running run, when the page is open, then new events appear within 2 s (SSE) or 4 s (polling fallback). · Must · T-WEB-run-view
- **AC-60** — Given a page refresh mid-run, then the view is reconstructed with no missing events. · Must · T-WEB-run-view
- **AC-61** — Pass/fail is conveyed by text and icon, not colour alone; live updates use `aria-live`. · Must · T-WEB-a11y

## F16 Reports
- **AC-62** — Given a completed run, then a report with an unguessable slug exists and is readable without login. · Must · T-API-reports
- **AC-63** — Reports contain no secrets, buyer credentials or raw signatures (automated scan). · Must · T-SEC-report-redaction
- **AC-64** — Reports include a "real vs simulated" section generated from attack specs. · Must · T-API-reports

## F17 Eval
- **AC-65** — `pnpm eval:bugs --offline` runs in CI in < 5 min and fails on any matrix deviation. · Must · CI
- **AC-66** — Live eval writes `eval/results/<date>.json` and a Markdown summary with the metrics in `docs/15` §6. · Must · eval

## F18 CLI
- **AC-67** — `cct run --target buggybeans:demo --mode checklist --wait` exits 0 and prints the findings table. · Should · T-CLI

## Non-functional
- **AC-NF-01** — No occurrence of the production PayPal host outside `docs/`; CI enforces. · Must
- **AC-NF-02** — The web bundle contains no secret names or values (CI grep). · Must
- **AC-NF-03** — A demo-preset agent run completes in ≤ 15 min on the hosted engine (judgement target; measured in rehearsal). · Must
- **AC-NF-04** — The hosted demo passes 5 consecutive rehearsals before submission. · Must
- **AC-NF-05** — A fresh clone runs locally with the README in ≤ 30 min of setup by someone new (dry run by a friend or a fresh VM). · Must
- **AC-NF-06** — Repository is public with an OSI licence visible in the About section. · Must (rules ✅)
- **AC-NF-07** — Video < 3 min, public on YouTube, shows the project working end to end. · Must (rules ✅)

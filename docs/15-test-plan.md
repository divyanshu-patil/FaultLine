# 15. Test plan — what is tested, how, and how to run it

## 1. Levels

| Level | Tool | Network | Runs in CI | What it proves |
| --- | --- | --- | --- | --- |
| Unit | vitest | none | yes | pure logic: invariants, rules matching, evidence IDs, redaction, patch guard, parsers |
| Integration (service) | vitest + supertest | none (fakes) | yes | Express routes, DB queries (Postgres in Docker or pg-mem ⚠️), proxy behaviour with FakePayPal |
| Worker integration | vitest | none (fakes) | yes | run state machine end to end with FakePayPal, FakeOllama, real BuggyBeans child processes |
| UI e2e | Playwright | none (API fakes via MSW or a fake API server) | yes | screens, live view reducer, accessibility checks |
| Sandbox (live) | vitest + Playwright | PayPal sandbox + tunnel | manual / nightly | real purchases, real webhooks, attacks against real PayPal |
| Evals | scripts | offline or live | offline in CI | detection matrix, agent quality, patch success |
| Rehearsal | `demo:rehearse` | hosted | manual | the exact demo works repeatedly |

## 2. Test doubles (`packages/testing`)

- **FakePayPal**: in-memory Orders v2 (create, approve via test hook, capture, get), webhook emitter with signed-like headers, verify endpoint (accepts only deliveries it emitted), negative-testing header support, `PayPal-Request-Id` idempotency, configurable latency.
- **FakeOllama**: scripted responses per purpose (valid, invalid JSON, wrong tool, invented evidence ID, injection-obeying), token counts.
- **FakeClock**, **FakeBrowser** (records intended steps for unit tests of the buyer).
- Fixtures: recorded real sandbox responses from spikes S0–S5 (redacted), used to keep FakePayPal honest. A contract test compares FakePayPal outputs to these fixtures' shapes.

## 3. Test catalogue

| Test ID | Level | What is tested | Key cases |
| --- | --- | --- | --- |
| T-API-session | integration | login, cookie, auth guard, rate limit | valid/invalid code, missing cookie, 6th attempt 429 |
| T-API-targets | integration | presets, hosted vs selfhost, verify flow | AC-04..06 |
| T-API-runs | integration | create, conflict, get, events, SSE framing, cancel | AC-08, AC-09 |
| T-API-reports | integration | public access, slug randomness, real-vs-simulated section | AC-62, AC-64 |
| T-WK-state-machine | worker | transitions, degradation, cancel, lease reclaim | AC-10..12 |
| T-WK-instances | worker | start/stop, port reuse, patched build fail, cleanup | AC-13, AC-14 |
| T-WK-buyer | worker (FakeBrowser + BuggyBeans) | tamper, block requests, double click | AC-17 |
| T-WK-settle | worker | waits for expected deliveries, stability, timeout note, truth path | AC-33, AC-34 |
| T-WK-verify | worker | same spec re-run, not_fixed loop, regression flag | AC-54, AC-55, AC-58 |
| T-PX-hooks | integration | fast ack, raw bytes, correlation, duplicate/hold/release/drop/forge | AC-20..25 |
| T-PX-forward | integration | allowlist, timeout_after_forward, negative_test header, latency, recording | AC-26..28 |
| T-TR-redact | unit | every secret pattern redacted in headers, bodies, query strings | AC-29 |
| T-TR-evidence | unit | ID format, uniqueness, `validateEvidenceRefs` | AC-30, AC-31 |
| T-CORE-invariants | unit | I1..I7 table-driven | AC-35 |
| T-CORE-attacks | unit | specs validate against schema; rules/invariants referenced exist | — |
| T-AG-recon | unit (FakeOllama) | excerpt building, rendered source has no `bugs.`, parsing, fallback | AC-42, AC-43 |
| T-AG-loop | unit (FakeOllama) | tool validation, invalid-count degradation, budgets, finish | AC-44..46 |
| T-AG-diagnose | unit | evidence rule, category consistency, repair, template | AC-49, AC-50 |
| T-AG-explore | worker | explore buyer on a markup-changed store | AC-19 |
| T-PATCH-guard | unit | one test per guard rule, accept a known-good patch per bug | AC-53 |
| T-SEC-ssrf | unit | private ranges, redirects, localhost rules | AC-07 |
| T-SEC-instance-env | worker | instance env has no forbidden keys | AC-15 |
| T-SEC-report-redaction | integration | scan report JSON/MD for secret values and raw signatures | AC-32, AC-63 |
| T-WEB-run-view | UI e2e | SSE updates, polling fallback, refresh reconstruction, degraded banner, forged label | AC-11, AC-24, AC-59, AC-60 |
| T-WEB-finding | UI e2e | diagnosis labels, diff, proof cards, reference fix label | AC-51, AC-56 |
| T-WEB-a11y | UI e2e | axe checks on S1–S8; keyboard paths; text+icon verdicts | AC-61 |
| T-SBX-purchase | sandbox | real purchase approve/abandon; screenshots policy | AC-16, AC-18 |
| T-SBX-attacks | sandbox | A1, A3, A4, A5, A7 on their bug and on the fixed store | AC-27, AC-28, AC-36..40 |
| T-CLI | integration | `faultline run … --wait` | AC-67 |

## 4. How to run

```bash
pnpm install
cp .env.example .env            # fill values (docs/17)
docker compose -f infra/docker-compose.yml up -d   # local Postgres (or point DATABASE_URL at Supabase)
pnpm db:migrate && pnpm seed

pnpm check                       # lint + typecheck + unit + integration + worker (fakes)
pnpm test --filter @faultline/core     # one package
pnpm test:e2e                    # UI e2e against fakes

# live sandbox (needs PayPal sandbox creds, buyer creds, tunnel running, webhook registered)
pnpm test:sandbox                # T-SBX-*
pnpm eval:bugs                   # live matrix (Must attacks), writes eval/results
pnpm eval:bugs --offline         # same matrix on FakePayPal (CI)
pnpm eval:agent --runs 3         # needs OLLAMA_API_KEY
pnpm demo:rehearse --times 5 --base-url https://<hosted-web>
```

## 5. Sandbox test rules

- Each live test creates its own instances and orders; no shared state.
- Never run sandbox suites on pull requests from forks (secrets).
- Throttle: one live attack at a time; the suite takes ~10–20 min (judgement).
- Flake policy: the buyer step may retry once on `infra_error`; verdict assertions never retry.
- Record PayPal debug IDs ⚠️ on failures for support.

## 6. Seeded-bug matrix (`pnpm eval:bugs`)

Configs: each single bug (B1…B8), `demo`, `all`, `none`. Modes: checklist (always), agent (with `--agent`).

Metrics written per config and overall:

| Metric | Definition |
| --- | --- |
| Detection | bug's expected invariants failed (per `docs/05` §5) |
| False positives | any failed invariant on `none` (must be 0) |
| Matrix deviations | any cell not matching `docs/05` §5 (must be 0) |
| Attacks used | count (agent vs checklist) |
| Wall time | seconds per run |

## 7. Agent quality eval (`pnpm eval:agent`)

On `demo` (and `all` with `--wide`), N runs (default 3):

| Metric | Target (judgement) |
| --- | --- |
| Must bugs found within budget | 5/5 in ≥ 2 of 3 runs |
| Attacks used vs checklist | fewer or equal |
| Diagnosis category accuracy | ≥ 80% |
| Raw evidence validity (before validation) | reported |
| Accepted evidence validity | 100% (by construction) |
| AI patches verified | ≥ 3 of 5 bugs in at least one run |
| Patch regressions | 0 |
| Injection variant | B1 still found |
| Tokens and model calls per run | reported |
| Degradations | reported |

Results go in `eval/results/` and the best honest numbers go in the README and Devpost text, with the date and model ID.

## 8. What is not tested (and why)

- Production PayPal: out of scope by rule.
- Load/performance beyond one run at a time.
- Real buyer funding instruments other than the sandbox personal account balance.

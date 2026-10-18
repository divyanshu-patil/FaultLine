# Checkout Crash Test — docs pack

> An AI agent that shops at your store to break it.

Checkout Crash Test (code name **CCT**) is a stress-tester for PayPal checkout integrations. An AI agent acts as a shopper and places real **PayPal sandbox** orders on a store. It then deliberately creates the conditions that break real integrations: duplicate and out-of-order webhooks, forged webhooks, a capture that times out after it succeeded, a tampered price, a declined payment. Deterministic checks decide pass or fail against PayPal's own record of the order. When something breaks, the agent explains the cause using only evidence from the trace and writes a patch. CCT then runs the same attack on the patched store to prove the fix.

Built for the PayPal AI Hackathon "Build What's Next with PayPal and AI" (Devpost). The submission deadline is **12 Nov 2026 12:00 pm PT = 13 Nov 2026 01:30 IST**. This plan targets submission on **Wed 11 Nov 2026, 18:00 IST**. Pack written Mon 19 Oct 2026 (IST).

## Stack (decided 2026-10-19)

| Concern | Choice |
| --- | --- |
| Monorepo | Turborepo + pnpm, TypeScript everywhere |
| Frontend | Next.js (App Router), UI only. Visual design comes from `docs/design.md` (supplied by the owner) |
| Backend | **Express 5** services: `apps/api` (product API), `apps/proxy` (webhook chaos proxy + PayPal API fault proxy), `apps/worker` (attack runner + agent + Playwright). Proxy and worker are deployed together as one "engine" service |
| Victim store | `apps/buggybeans`: a small Express store with switchable seeded bugs |
| Database | **Supabase** Postgres (plain Postgres via the session pooler; Drizzle ORM). BuggyBeans uses its own SQLite file per instance |
| LLM | **Ollama Cloud**, model **Gemma 4 31B** (`gemma4:31b` ⚠️ exact tag confirmed in spike S6) |
| Browser automation | Playwright (Chromium) |
| Payments | PayPal **sandbox only**: Orders v2, webhooks, webhook signature verification, negative testing, idempotency header |
| Hosting | Render (web, API, proxy, worker, BuggyBeans) — also makes the project eligible for the Render sponsor prize |
| Optional | Jev / Laya decision models for cheap "suspect" scoring (off by default) |

## Files

Copy `AGENTS.md`, `CLAUDE.md` and `judging.md` to the repo root and everything in `docs/` to `docs/`. Put your own `design.md` in `docs/design.md`.

| File | Read it to learn |
| --- | --- |
| `AGENTS.md` | the rules every coding agent must follow |
| `CLAUDE.md` | pointer for Claude Code |
| `judging.md` | official rules and criteria, how CCT scores on each, prize strategy, Stage One checklist |
| `docs/01-product-brief.md` | the user, the problem, scope, non-goals, success measures |
| `docs/02-architecture.md` | system design, components, flows (mermaid), state machines, decisions (ADR-001…016) |
| `docs/03-monorepo-structure.md` | Turborepo tree, packages, scripts, env vars, CI |
| `docs/04-features.md` | **how each feature works** (F1–F18) |
| `docs/05-attack-catalog.md` | every attack, the bug it targets, the invariant it checks, expected results |
| `docs/06-agent-spec.md` | the agent: Gemma 4 31B on Ollama Cloud, loop, tools, prompts, contracts, guardrails, budgets |
| `docs/07-paypal-integration.md` | what PayPal features are used and how, with verification marks |
| `docs/08-data-model.md` | Supabase tables, indexes, retention, migrations |
| `docs/09-api-spec.md` | Express routes for `apps/api`, `apps/proxy`, `apps/buggybeans` |
| `docs/10-victim-store.md` | BuggyBeans: pages, seeded bugs B1–B8, state probe |
| `docs/11-ui-spec.md` | screens and components (visuals from `docs/design.md`) |
| `docs/12-security-and-safety.md` | threat model, sandbox-only rule, target ownership, patch sandboxing, secrets |
| `docs/13-implementation-plan.md` | scope (MoSCoW), phases, dated tasks, go/no-go gates |
| `docs/14-acceptance-criteria.md` | Given/When/Then criteria with IDs |
| `docs/15-test-plan.md` | **what is tested, how, and the commands** |
| `docs/16-checks.md` | quality gates: PR, CI, pre-demo, pre-submission, judging window |
| `docs/17-runbook.md` | **how to execute**: accounts, env, local run, tunnel, deploy, run an attack, troubleshooting |
| `docs/18-risks-and-spikes.md` | Day-0 spikes S1–S11, risk register |
| `docs/19-demo-and-submission.md` | 3-minute video storyboard, Devpost text draft, submission checklist |
| `docs/20-start-prompts.md` | prompts to drive your coding agent phase by phase |

## Reading order for a new contributor

`AGENTS.md` → `01` → `02` → `04` → `05` → `06` → `13` → the doc for the task at hand.

## Verification marks used everywhere

- ✅ read in an official or primary source on 2026-10-19 (or 2026-10-17 where stated)
- ⚠️ from memory or a third-party source; verify before depending on it
- ❓ unverified or sources conflict; a spike must settle it

Nothing here states a market statistic, a win rate or a "no competitor" claim without a source. Estimates (hours, scores, budgets) are the author's judgement and are labelled.

## Facts that shape the plan

1. **PayPal says webhooks can be duplicated and arrive out of order** (Hookdeck's guide ✅, consistent with PayPal's webhook docs ⚠️). That is the core bug class CCT hunts.
2. **Simulator webhooks cannot be verified by PayPal's postback endpoint** ✅. CCT therefore records and replays **real** sandbox deliveries, and uses the simulator only for plumbing tests.
3. **PayPal sandbox has "negative testing"**: a `PayPal-Mock-Response` header makes Orders v2 create/capture return real error responses ✅. CCT uses it for the declined-payment attack.
4. **`PayPal-Request-Id` makes retries idempotent** where supported ✅ (Orders v2 support ⚠️, spike S4). The fix for the capture-timeout bug relies on it.
5. **The PayPal popup may resist automation** (captcha/bot checks) ❓. Spike S1 on Day 0 decides the buyer-agent approach.
6. **Ollama Cloud structured output support is unclear** ❓ (docs read on 2026-10-17 said none; a 2026 third-party guide says `format` works). Every model output is parsed and validated by code anyway, and every AI step has a non-AI fallback.
7. **Only AG Grid, APIMatic, Bryntum, Channel3 and Render have sponsor prizes** ✅. KERNEL and Postman tools are allowed but carry no prize. Render is the natural sponsor track for CCT.
8. **Judges may judge from the text, images and video alone** ✅. The video and the README must show the full loop on their own.

## Glossary

| Term | Meaning |
| --- | --- |
| Target | a store CCT is allowed to attack (BuggyBeans, or a verified self-hosted sandbox store) |
| Run | one session against one target: recon → attacks → diagnosis → patch → verify → report |
| Attack | a scripted disturbance (A1–A8) executed against the target, e.g. duplicate webhook |
| Invariant | a deterministic rule that must hold after an attack (I1–I7), e.g. "credits granted once per capture" |
| Finding | a failed invariant with its evidence |
| Trace | everything recorded during an attack: browser steps, PayPal API calls, webhook deliveries, store state snapshots |
| Settle window | the time CCT waits for webhooks and state to stabilise before checking invariants (default 60 s) |
| Checklist mode | a run with no AI: every attack in a fixed order. Baseline and fallback |
| Agent mode | the AI chooses attacks, diagnoses failures and writes patches |
| BuggyBeans | the bundled victim store with switchable seeded bugs B1–B8 |
| State probe | the read-only endpoint a target exposes so CCT can see its orders and entitlements |

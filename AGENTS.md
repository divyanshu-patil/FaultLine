# AGENTS.md — rules for coding agents

You are building **FaultLine (FaultLine)**. Read `docs/02-architecture.md` and `docs/13-implementation-plan.md` before writing code. Work on one task ID at a time and say which one.

## Hard rules (never break these)

1. **Sandbox only.** The only PayPal API host allowed anywhere is `https://api-m.sandbox.paypal.com`. Never write the production host (`api-m.paypal.com`) in code, config, tests or docs examples. `@faultline/paypal` enforces an allowlist; never bypass it. CI greps for the production host and fails (only `docs/`, `AGENTS.md` and `judging.md` may mention it, as a prohibition).
2. **Secrets never leave the server.** PayPal client secret, Ollama key, Jev/Laya keys, `DATABASE_URL`, `PROBE_TOKEN`, `PROXY_CONTROL_TOKEN` exist only in `apps/api`, `apps/proxy`, `apps/worker`, `apps/buggybeans` env. Nothing secret in `apps/web` or any `NEXT_PUBLIC_*` variable. Never log secrets. Redact `Authorization`, `client_secret`, `access_token` in every stored trace.
3. **The AI never decides truth.** Pass/fail comes only from `@faultline/core` invariant checkers using PayPal's API response and the target's state probe. The model may choose attacks, explain, and propose patches. It may never mark an invariant passed, change a verdict, or cite an ID that is not in the trace (`validateEvidenceRefs` rejects it).
4. **Only attack allowed targets.** Hosted mode (`FAULTLINE_MODE=hosted`) allows only BuggyBeans instances started by FaultLine. Self-hosted mode allows external targets only after ownership verification (`docs/12-security-and-safety.md` §3). Never add a code path that sends attack traffic to an unverified host.
5. **AI patches run only in a throwaway BuggyBeans instance.** Never apply a model-written patch to the FaultLine codebase, to a user's repo, or to a running shared service. Patch guard rules in `docs/12` §5 are mandatory.
6. **Validate every boundary with zod.** HTTP bodies, tool-call arguments, model outputs, PayPal responses we depend on, webhook payloads, env vars.
7. **No fake success.** A timeout, a 4xx/5xx or a missing webhook is shown as what it is. Never write "completed" for something PayPal did not confirm. Simulated data (simulator webhooks, fixtures) is labelled as simulated in the UI and in reports.
8. **Use the verification marks.** When you rely on a PayPal or Ollama behaviour, check `docs/07-paypal-integration.md` or `docs/06-agent-spec.md`. If it is marked ⚠️ or ❓ and your code depends on it, add a test or note the spike that settles it.

## How to work

- TypeScript strict. ESM. Node 22 LTS ⚠️ (confirm in S0).
- Express 5 for every server. One `createApp(deps)` factory per app so tests can inject fakes (`supertest`).
- Pure logic lives in `packages/*`; apps are thin.
- Tests first for invariants, attack definitions, evidence validation and patch guard.
- Every external dependency (PayPal, Ollama, Supabase, Playwright, clock) sits behind an interface with an in-memory fake.
- Keep functions small; no `any`; no default exports except Next.js pages.
- Errors: throw typed `AppError` subclasses; one Express error handler maps them to `{error:{code,message,requestId}}`.
- Logging: `pino`, JSON, with `requestId` and `runId`. No PII, no secrets.
- Commits: Conventional Commits (`feat(worker): add A4 capture timeout attack`).

## Definition of done for any task

- Typecheck, lint and tests pass (`pnpm check`).
- New behaviour has tests at the right level (`docs/15-test-plan.md`).
- Acceptance criteria IDs touched are listed in the PR description and pass.
- Docs updated if behaviour, routes, env vars or tables changed.
- No new ⚠️/❓ dependency without a note.

## When unsure

Stop and write the question in the PR description. Do not invent PayPal endpoints, fields, error codes or event names. If something is missing from `docs/07`, it is not allowed until a spike confirms it and the doc is updated.

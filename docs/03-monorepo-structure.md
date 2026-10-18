# 03. Monorepo structure

Turborepo + pnpm workspaces. Package scope `@cct/*`. Node 22 LTS ⚠️ (confirm current LTS in S0). Express 5 (5.1 became the npm default on 2025-03-31 ✅ expressjs.com).

## 1. Tree

```
checkout-crash-test/
├── AGENTS.md  CLAUDE.md  judging.md  README.md  LICENSE
├── docs/                         # this pack + design.md (owner-provided)
├── apps/
│   ├── web/                      # Next.js UI only (App Router)
│   │   ├── app/
│   │   │   ├── page.tsx                      # home
│   │   │   ├── login/page.tsx                # access code
│   │   │   ├── targets/page.tsx
│   │   │   ├── runs/new/page.tsx
│   │   │   ├── runs/[runId]/page.tsx         # live run
│   │   │   ├── runs/[runId]/findings/[findingId]/page.tsx
│   │   │   ├── reports/[slug]/page.tsx       # shareable, read-only
│   │   │   └── attacks/page.tsx              # catalog
│   │   ├── components/                       # per docs/11-ui-spec.md
│   │   ├── lib/api.ts                        # typed client for /api/*
│   │   ├── lib/sse.ts
│   │   └── next.config.ts                    # rewrites /api/* → API_ORIGIN
│   ├── api/                      # Express 5 product API
│   │   ├── src/app.ts                        # createApp(deps)
│   │   ├── src/server.ts
│   │   ├── src/env.ts                        # zod-validated env
│   │   ├── src/routes/{health,session,targets,runs,findings,reports,attacks}.ts
│   │   ├── src/middleware/{request-id,session,rate-limit,error}.ts
│   │   └── test/
│   ├── proxy/                    # Express 5: webhook chaos proxy + API fault proxy + instance gateway
│   │   ├── src/app.ts                        # createProxyApp(deps)
│   │   ├── src/routes/{hooks,paypal-forward,instances,control}.ts
│   │   ├── src/rules/                        # rule matching, fault application
│   │   ├── src/correlate.ts
│   │   └── test/
│   ├── worker/                   # run state machine, agent, executor, Playwright, instance manager
│   │   ├── src/worker.ts                     # job loop
│   │   ├── src/engine.ts                     # hosted entry: proxy app + worker loop in one process
│   │   ├── src/run/{state-machine,recon,attack-runner,settle,diagnose,patch,verify,report}.ts
│   │   ├── src/buyer/{scripted,explore}.ts   # Playwright buyer
│   │   ├── src/instances/{manager,patched}.ts
│   │   └── test/
│   ├── buggybeans/               # victim store (Express 5 + SQLite + PayPal JS SDK)
│   │   ├── src/server.ts
│   │   ├── src/bugs.ts                       # parses BUGS env → flags B1..B8
│   │   ├── src/routes/{pages,orders,webhooks,account,probe}.ts
│   │   ├── src/db.ts                         # better-sqlite3
│   │   ├── public/                           # product page, checkout.js
│   │   └── test/
│   └── cli/                      # (Should) `cct` command
├── packages/
│   ├── schemas/                  # zod: API DTOs, run events, attack/rule specs, model contracts, probe contract
│   ├── core/                     # attack catalog A1–A8, invariants I1–I7, verdict model, budgets (pure)
│   ├── paypal/                   # sandbox client, OAuth cache, allowlist, verify-webhook-signature, mock-response helper
│   ├── trace/                    # trace model, recorder, redaction, evidence ID scheme
│   ├── agent/                    # Ollama client, tool registry, loop, prompts, parsers, repair, fallbacks
│   ├── classifier/               # (Could) Jev/Laya adapter; noop default
│   ├── patch/                    # unified-diff apply, patch guard, file allowlist
│   ├── db/                       # Drizzle schema, migrations, queries, job queue
│   ├── testing/                  # fakes: FakePayPal, FakeOllama, FakeClock, fixtures
│   └── config/                   # tsconfig, eslint, vitest presets
├── infra/
│   ├── docker-compose.yml        # local Postgres (optional if using Supabase)
│   ├── render.yaml               # Blueprint (web, api, engine, buggybeans-public)
│   └── supabase/migrations/      # generated SQL from Drizzle
├── scripts/
│   ├── seed.ts                   # targets, demo report
│   ├── demo-rehearse.ts          # runs the demo scenario N times
│   └── check-no-prod-host.sh     # CI grep
├── turbo.json  pnpm-workspace.yaml  package.json  .env.example  .gitignore  .github/workflows/ci.yml
```

## 2. Dependency rules

```
apps/web      → @cct/schemas
apps/api      → @cct/schemas, @cct/db, @cct/core
apps/proxy    → @cct/schemas, @cct/db, @cct/paypal, @cct/trace
apps/worker   → everything in packages/ except config-only
apps/buggybeans → (nothing from @cct except @cct/schemas for the probe contract)
packages/core → @cct/schemas
packages/agent → @cct/schemas, @cct/core, @cct/trace, @cct/classifier
packages/patch → (none)
```

BuggyBeans deliberately does **not** import `@cct/paypal`: it is meant to look like an ordinary store integration written by a third party.

## 3. Root scripts (`package.json`)

| Script | Does |
| --- | --- |
| `pnpm dev` | turbo dev: web, api, engine (proxy + worker), buggybeans-public |
| `pnpm build` | turbo build |
| `pnpm check` | lint + typecheck + unit + integration tests |
| `pnpm test` | vitest across workspaces |
| `pnpm test:e2e` | Playwright UI tests for `apps/web` against fakes |
| `pnpm test:sandbox` | live sandbox suite (needs PayPal creds + tunnel) |
| `pnpm eval:bugs` | seeded-bug matrix (`docs/15` §6) |
| `pnpm eval:agent` | agent quality eval (needs `OLLAMA_API_KEY`) |
| `pnpm demo:rehearse` | demo scenario ×5 from fresh state |
| `pnpm db:generate` / `db:migrate` | Drizzle migrations |
| `pnpm seed` | seed targets |
| `pnpm cct -- <args>` | CLI (Should) |

## 4. `turbo.json` (outline)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] }
  },
  "globalEnv": ["NODE_ENV", "CCT_MODE"]
}
```

## 5. Environment variables

Every app validates its env with zod at boot and refuses to start on missing or malformed values. `.env.example` lists names only.

### apps/web

| Name | Example | Notes |
| --- | --- | --- |
| `API_ORIGIN` | `http://localhost:4000` | server-side only, used by rewrites |
| `NEXT_PUBLIC_APP_NAME` | `Checkout Crash Test` | nothing secret may be `NEXT_PUBLIC_*` |

### apps/api

| Name | Notes |
| --- | --- |
| `PORT` | 4000 local; Render sets its own ⚠️ |
| `DATABASE_URL` | Supabase **session pooler** (5432) or direct URL. Never port 6543 |
| `SESSION_SECRET` | ≥ 32 bytes, signs the session cookie |
| `ACCESS_CODES` | comma-separated demo access codes (judges get one in the Devpost testing instructions) |
| `CCT_MODE` | `hosted` or `selfhost` |
| `ALLOW_EXTERNAL_TARGETS` | `false` in hosted mode (enforced) |
| `PUBLIC_REPORT_BASE_URL` | for shareable report links |
| `OPERATOR_CODES` | access codes allowed to start evals (`POST /api/evals`) |

### apps/proxy + apps/worker (engine)

| Name | Notes |
| --- | --- |
| `PORT` | engine HTTP port (proxy routes) |
| `PUBLIC_BASE_URL` | public URL of the engine (tunnel URL locally) |
| `DATABASE_URL` | as above |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | sandbox REST app used by BuggyBeans instances and for truth reads |
| `PAYPAL_WEBHOOK_ID` | ID of the webhook registered on that app (URL `PUBLIC_BASE_URL/hooks/paypal`) |
| `PAYPAL_API_HOST` | must equal `https://api-m.sandbox.paypal.com`; any other value fails boot |
| `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD` | sandbox **personal** account for the Playwright buyer |
| `PROXY_CONTROL_TOKEN` | only needed when proxy and worker run as separate processes |
| `PROBE_TOKEN` | shared secret passed to BuggyBeans instances for `/__crashtest/state` |
| `OLLAMA_HOST` | default `https://ollama.com` |
| `OLLAMA_API_KEY` | Ollama Cloud key |
| `OLLAMA_MODEL` | default `gemma4:31b` ⚠️ (S6 fixes the exact tag) |
| `OLLAMA_TIMEOUT_MS` | default 90000 |
| `AGENT_MAX_STEPS`, `AGENT_MAX_ATTACKS`, `AGENT_MAX_PATCH_ATTEMPTS`, `AGENT_MAX_MODEL_CALLS`, `AGENT_MAX_TOKENS`, `RUN_WALL_CLOCK_SECONDS` | budgets (defaults in `docs/06` §8) |
| `TOOL_PROTOCOL` | `json` (default until S6) or `native` |
| `SETTLE_SECONDS` | default 60 |
| `CLASSIFIER_PROVIDER` | `none` (default), `jev`, `laya` |
| `CLASSIFIER_API_KEY`, `CLASSIFIER_BASE_URL` | only when a provider is set |
| `PLAYWRIGHT_HEADLESS` | `true` in hosted |
| `KERNEL_API_KEY` | (Could) if the buyer browser runs on KERNEL instead of local Chromium |
| `INSTANCE_PORT_RANGE` | e.g. `5100-5199` |
| `MAX_LIVE_INSTANCES` | default 4 |
| `JOB_LEASE_SECONDS` | default 120 |

### apps/buggybeans (set by the instance manager; also used by `buggybeans-public`)

| Name | Notes |
| --- | --- |
| `PORT`, `PUBLIC_URL`, `INSTANCE_ID` | |
| `BUGS` | `all`, `none`, or a list like `B1,B3,B4` |
| `SQLITE_PATH` | per-instance file |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | same sandbox app |
| `PAYPAL_API_BASE` | engine proxy URL `…/paypal/<instanceId>`; for `buggybeans-public` the real sandbox host |
| `PROBE_TOKEN` | |

## 6. CI (`.github/workflows/ci.yml`)

1. `pnpm install --frozen-lockfile`
2. `pnpm check` (lint, typecheck, unit, integration with fakes)
3. `scripts/check-no-prod-host.sh` — fails if the production host (`api-m.paypal.com`, i.e. without `sandbox.`) appears anywhere except `docs/`, `AGENTS.md`, `judging.md` and the script itself
4. Secret scan (gitleaks) on the diff
5. `pnpm build`, then grep `apps/web/.next` for `OLLAMA_API_KEY`, `PAYPAL_CLIENT_SECRET`, `sk-`, `Bearer ` → fail if found
6. `pnpm test:e2e` (UI against fakes)
7. `pnpm eval:bugs --offline` (seeded-bug matrix with FakePayPal; no network)

Live sandbox and model evals run manually or on a nightly schedule with secrets, never on pull requests from forks.

## 7. Conventions

- vitest for unit/integration, supertest for Express, Playwright for browser tests.
- `tsup` builds services to `dist/`.
- Drizzle for schema and migrations; SQL committed in `infra/supabase/migrations`.
- pino logs; `requestId`, `runId`, `attackId` on every line.

# 09. API spec (Express 5)

Conventions for every service:
- JSON only; body limit 1 MB (webhook route reads raw bytes with the same limit).
- Every request gets `x-request-id` (incoming value kept if it is a UUID, else generated).
- Errors: `{"error":{"code":"RUN_NOT_FOUND","message":"…","requestId":"…"}}` with the HTTP status from the table below. Never leak stack traces.
- All inputs parsed with zod in the handler (`parse(schema, req.body)` → `400 VALIDATION_FAILED` with `issues`).
- `helmet`, `express-rate-limit`, `pino-http`.

| Code | Status |
| --- | --- |
| `VALIDATION_FAILED` | 400 |
| `UNAUTHENTICATED` / `INVALID_CODE` | 401 |
| `FORBIDDEN` / `TARGET_NOT_ALLOWED` / `UPSTREAM_PATH_NOT_ALLOWED` | 403 |
| `RUN_NOT_FOUND` / `TARGET_NOT_FOUND` / `FINDING_NOT_FOUND` / `REPORT_NOT_FOUND` | 404 |
| `RUN_ALREADY_ACTIVE` / `TARGET_NOT_VERIFIED` | 409 |
| `RATE_LIMITED` | 429 |
| `INTERNAL` | 500 |
| `UPSTREAM_TIMEOUT` | 504 |

## 1. `apps/api` (product API, behind the Next.js `/api/*` rewrite)

### Health and session

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | none | `?db=1` checks DB | `200 {ok, version, mode, db?: "ok"}` |
| POST | `/api/session` | none | `{code}` | `204` + `Set-Cookie: fl_session` |
| DELETE | `/api/session` | session | — | `204` |
| GET | `/api/me` | session | — | `{sessionId, expiresAt, activeRunId}` |

### Attacks catalog

| GET | `/api/attacks` | session | — | `[{id, name, priority, bugClass, invariants, realVsSimulated, description}]` |
| --- | --- | --- | --- | --- |

### Targets

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/targets` | session | — | `[{id, slug, kind, name, status}]` (never includes `bugs` for BuggyBeans presets except `custom` selections made by the same session) |
| POST | `/api/targets` | session; selfhost only | `{name, baseUrl, webhookPath, probePath, source: {type:"path"|"zip", value}}` | `201 {id, verifyToken, instructions}` |
| POST | `/api/targets/:id/verify` | session; selfhost only | — | `200 {status:"verified"}` or `409 TARGET_NOT_VERIFIED {reason}` |
| POST | `/api/targets/custom` | session | `{bugs: ("B1".."B8")[]}` | `201 {id}` (BuggyBeans custom preset) |

### Runs

| Method | Path | Auth | Body / query | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/runs` | session | `{targetId, mode:"agent"|"checklist", attacks?: AttackId[], budget?: {maxAttacks?, maxSteps?, maxPatchAttempts?}}` | `202 {runId}`; `409 RUN_ALREADY_ACTIVE` |
| GET | `/api/runs` | session | `?limit=20` | `[{id, target, mode, effectiveMode, status, phase, createdAt, summary}]` |
| GET | `/api/runs/:id` | session | — | run detail: status, phase, usage, attacks with verdict summaries, findings, reportSlug |
| GET | `/api/runs/:id/events` | session | `?after=<eventId>` | `[{id, kind, payload, createdAt}]` (polling fallback) |
| GET | `/api/runs/:id/stream` | session | header `Last-Event-ID` | `text/event-stream` (below) |
| POST | `/api/runs/:id/cancel` | session | — | `202` |
| GET | `/api/runs/:id/attacks/:attackRowId/trace` | session | `?kind=` | `[{evidenceId, kind, at, summary}]` |
| GET | `/api/evidence/:runId/:evidenceId` | session | — | `{evidenceId, kind, summary, detail}` (redacted; screenshots as `image/jpeg` via `?raw=1`) |

SSE format:

```text
id: 1842
event: run_event
data: {"kind":"verdict","payload":{"attack":"A1","invariant":"I2","status":"fail","expected":"100","actual":"300","evidence":["st-0004","wf-0006"]}}

```

Heartbeat comment `: ping` every 15 s. The stream closes after `completed|failed|cancelled` plus the final event.

### Findings, patches, reports

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/api/findings/:id` | session | finding + verdicts + evidence summaries + diagnosis + patches (diffs) + verification results |
| POST | `/api/findings/:id/reverify` | session | `202` re-runs the attack on the latest verified patch (Should) |
| GET | `/api/reports/:slug` | **public** | frozen report JSON |
| GET | `/api/reports/:slug?format=md` | public | Markdown export (Should) |

### Eval (operator only)

| POST | `/api/evals` | session with operator code (`OPERATOR_CODES`) | `{matrix:"default"|"quick", modes:["checklist","agent"]}` → `202 {evalId}` |
| --- | --- | --- | --- |

## 2. `apps/proxy` (inside the engine)

### Webhook ingress

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/hooks/paypal` | raw body; store delivery; correlate; respond `200 {received:true}` within 1 s; then apply rules asynchronously |

### PayPal forward (fault proxy)

| Method | Path | Notes |
| --- | --- | --- |
| ANY | `/paypal/:instanceId/*` | `instanceId` must be live; upstream path must be allowlisted (`docs/07` §8); forwards to the sandbox host; records `paypal_calls`; applies fault rules |

### Instance gateway

| Method | Path | Notes |
| --- | --- | --- |
| ANY | `/i/:instanceId/*` | reverse proxy to `127.0.0.1:<port>`; strips prefix; rewrites `Location` headers; 404 if not live |

### Control (in-process in hosted mode; HTTP with `PROXY_CONTROL_TOKEN` when split)

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| PUT | `/control/runs/:runId/rules` | `{webhookRules: WebhookRule[], faultRules: FaultRule[]}` | replaces the run's active rules |
| DELETE | `/control/runs/:runId/rules` | — | clears |
| POST | `/control/runs/:runId/release` | `{deliveryIds: string[] }` | release held deliveries in the given order |
| POST | `/control/runs/:runId/forge` | `{template:"capture_completed", orderId, mutate?}` | sends a forged delivery to the run's instance |
| PUT | `/control/instances/:instanceId` | `{port, runId}` | register |
| DELETE | `/control/instances/:instanceId` | — | unregister |

Rule schemas (`@faultline/schemas/rules`):

```ts
type WebhookRule =
  | { match: { eventType?: string }; action: "pass" }
  | { match: { eventType?: string }; action: "duplicate"; times: number; gapMs: number }
  | { match: { eventType?: string }; action: "delay"; ms: number }
  | { match: { eventType?: string }; action: "hold" }          // released via /release
  | { match: { eventType?: string }; action: "drop" };

type FaultRule = {
  match: { method: "GET" | "POST"; pathPattern: string; occurrence?: number }; // occurrence: 1 = first match only
  fault:
    | { kind: "timeout_after_forward"; ms: number }
    | { kind: "error_before_forward"; status: number }
    | { kind: "negative_test"; code: string }
    | { kind: "latency"; ms: number };
};
```

## 3. `apps/buggybeans` (victim store)

These routes are what FaultLine expects of any target; external stores implement the probe contract only.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | product list |
| GET | `/p/:sku` | product page with PayPal buttons |
| POST | `/api/orders` | `{sku, qty, amount?}` → creates PayPal order; **B5** uses `amount` if present |
| POST | `/api/orders/:paypalOrderId/capture` | server capture; behaviour depends on **B4**, **B7** |
| POST | `/api/orders/:paypalOrderId/fulfil` | exists only with **B6** |
| POST | `/webhooks/paypal` | behaviour depends on **B1**, **B2**, **B3**, **B8** |
| GET | `/account` | shows credits balance (demo buyer) |
| GET | `/healthz` | `200` |
| GET | `/__crashtest/state` | probe (below); requires `Authorization: Bearer $PROBE_TOKEN` |
| GET | `/__crashtest/catalog` | `[{sku, name, price, currency, creditsPerItem}]`; same auth |

### Probe contract (`@faultline/schemas/probe`)

```json
{
  "storeTime": "2026-11-02T10:15:00Z",
  "orders": [
    {"storeOrderId": "o_12", "paypalOrderId": "5O190127TN364715T", "sku": "house-blend", "qty": 1,
     "status": "paid", "captureId": "3C679366HH908993F", "amount": "12.00", "currency": "USD",
     "updatedAt": "…"}
  ],
  "entitlements": [
    {"storeOrderId": "o_12", "credits": 100, "source": "webhook|capture|fulfil", "grantedAt": "…", "ref": "WH-… or capture id"}
  ],
  "webhookEvents": [
    {"eventId": "WH-…", "type": "PAYMENT.CAPTURE.COMPLETED", "receivedAt": "…", "outcome": "processed|ignored|rejected"}
  ]
}
```

`status` vocabulary: `created`, `approved`, `pending_capture`, `paid`, `fulfilled`, `failed`, `abandoned`.

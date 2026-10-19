# 21. Integrate your store

Point FaultLine at **your own** PayPal checkout integration and have it run the same crash tests it runs against BuggyBeans — duplicate, out-of-order and dropped webhooks, a tampered price, a fulfil-without-capture, a declined payment — then get a deterministic pass/fail per invariant. **Sandbox only.** Verdicts come from the checker, never from the AI.

This is the **self-host** path: you run FaultLine (it's MIT-licensed) next to your store, so you never hand your store or its credentials to anyone. There are two front doors — a **CLI** and the **web UI** — and both drive the same engine.

> Status: the external path runs on the **simulated PayPal backend** (FaultLine stands in for PayPal so no live buyer approval is needed). Attacks **A1, A2, A5, A6, A7, A8** run externally. **A3** (forged event) and **A4** (withheld capture response) need the operator hooks in `apps/proxy/src/stubs.ts` and are skipped otherwise.

---

## 1. How it works

```
 FaultLine CLI / web ──drives──► your store ──PayPal calls──► FaultLine simulated PayPal
          ▲                          │                                   │
          └────── reads state ◄──────┘        webhooks (disturbed) ◄──────┘
                 (the probe)              via FaultLine's webhook proxy
```

FaultLine starts a **simulated PayPal** and a **webhook-disturbance proxy**. Your store is configured to call that simulated PayPal instead of the live sandbox. FaultLine drives a purchase through your store's own endpoints, disturbs the webhooks on the way back (replays, reorders, drops), reads your store's internal state through a read-only **probe**, and compares it to PayPal's record with the deterministic invariants `I1…I7`.

The AI is never in this path. It can later explain and patch a finding, but it cannot decide pass or fail.

---

## 2. The contract your store implements

Implement these HTTP endpoints (the default paths match the bundled reference store, `apps/buggybeans` — read it as a worked example). All are sandbox-only.

### 2.1 Create order — `POST /api/orders`
Request `{"sku": "house-blend", "qty": 1, "amount": "0.01"?}` — `amount` is an **optional** client-supplied override; a correct store ignores it and prices from its own catalog (that's attack **A5**). Create the PayPal order against `PAYPAL_API_BASE` and respond:
```json
{ "id": "<the PayPal order id>" }
```

### 2.2 Capture — `POST /api/orders/{paypalOrderId}/capture`
Capture the order against PayPal and respond `{ "status": "COMPLETED" }` on success (any other status / an error body signals the buyer saw a failure).

### 2.3 Fulfil without capture — `POST /api/orders/{paypalOrderId}/fulfil` (optional)
Only a **buggy** store should grant goods here without a capture (attack **A6**). A correct store should not expose this route (respond `404`), which is exactly what the checker verifies.

### 2.4 Webhook receiver — `POST /webhooks/paypal`
Receive PayPal webhook deliveries, **verify the signature** (call `POST /v1/notifications/verify-webhook-signature` on `PAYPAL_API_BASE` with your `PAYPAL_WEBHOOK_ID`), and update your state. FaultLine delivers here through its proxy, sometimes duplicated, reordered or withheld.

### 2.5 State probe — `GET /__crashtest/state`
Read-only. Require `Authorization: Bearer <PROBE_TOKEN>` (constant-time compare). Return your store's view so the checker can compare it to PayPal's truth:
```json
{
  "storeTime": "2026-10-19T12:00:00.000Z",
  "orders": [
    { "storeOrderId": "o_ab12", "paypalOrderId": "5LU...", "sku": "house-blend",
      "qty": 1, "status": "paid", "captureId": "3EM...", "amount": "12.00",
      "currency": "USD", "updatedAt": "..." }
  ],
  "entitlements": [
    { "storeOrderId": "o_ab12", "credits": 100, "source": "webhook", "grantedAt": "...", "ref": "3EM..." }
  ],
  "webhookEvents": [
    { "eventId": "WH-...", "type": "PAYMENT.CAPTURE.COMPLETED", "receivedAt": "...", "outcome": "processed" }
  ]
}
```
`entitlements` is whatever your store grants on payment (credits, licences, shipped goods — model it as a credit count). The probe must be a **pure read**; it never mutates state, and a patch may never touch it.

---

## 3. Configure your store (sandbox only)

Set these in your store's environment:

| Variable | Value |
|----------|-------|
| `PAYPAL_API_BASE` | the **simulated PayPal URL** FaultLine prints when it starts (e.g. `http://127.0.0.1:4500`) |
| `PAYPAL_WEBHOOK_ID` | the webhook id FaultLine prints (default `8PT597110X687430LKGECATA`) |
| `PROBE_TOKEN` | a random ≥16-char token; the same value you pass to FaultLine |

That's it — no real PayPal credentials are needed for the simulated backend. For a **live** sandbox run (real PayPal, documented separately) your store keeps its own sandbox app credentials and points `PAYPAL_API_BASE` at FaultLine's fault proxy instead.

---

## 4. Run it — CLI

```bash
git clone <this repo> && cd FaultLine
pnpm install                       # Node 24+ (native TS, no build step)

# from the repo root:
pnpm --filter faultline faultline -- test \
  --store http://127.0.0.1:4600 \
  --probe-token "$PROBE_TOKEN" \
  --paypal-port 4500 --proxy-port 4510 \
  --attacks A1,A2,A5,A6,A7,A8
```

FaultLine prints the simulated-PayPal URL to point your store at, runs each attack, and prints a table:

```
ATTACK  RESULT
A5      BUG — failed I3  (Price tampering)
A7      ok — no invariant failed
...
2 bugs found, 0 attacks errored, of 6 run. Sandbox only.
```

Useful flags: `--json` (machine-readable), `--sku <sku>`, `--fail-on-findings` (exit non-zero if any bug is found — for a CI gate), `--host <host>` (bind address if your store is on another machine). `faultline attacks` lists what runs externally.

> Keep the ports stable (`--paypal-port`/`--proxy-port`) so your store's `PAYPAL_API_BASE` stays valid between runs.

---

## 5. Run it — web UI

In **self-host mode** (`FAULTLINE_MODE=selfhost`, `ALLOW_EXTERNAL_TARGETS=true`), the web app's **Integrate** page walks through the same steps and lets you register your store (base URL + probe token), verify it exposes the probe, and launch a run you can watch live with the invariant board, the agent's explanation and a proven fix. In hosted mode external targets are disabled (you'd attack an arbitrary URL), so the Integrate page shows these setup instructions and points you to self-host.

---

## 6. Reference implementation

`apps/buggybeans` is a complete store that implements this contract (with deliberately-seeded bugs you can toggle). Read `src/routes/orders.ts`, `src/routes/webhooks.ts` and `src/routes/probe.ts` to see each endpoint, and `src/server.ts` for the env wiring. A correct store is BuggyBeans with every bug flag off.

---

## 7. Security

- **Sandbox only.** FaultLine refuses any PayPal host but the sandbox, and the simulated backend never touches the network. Never point it at production.
- The **probe token** gates the state probe; use a fresh random value and treat it like a secret.
- The probe is **read-only** and must never expose customer PII — model entitlements as counts/ids.
- Self-host so your store and its credentials stay with you. In hosted deployments external targets stay disabled to avoid attacking a URL you don't own (SSRF); ownership verification is required before that is ever enabled.

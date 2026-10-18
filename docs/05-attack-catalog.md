# 05. Attack catalog, invariants and seeded bugs

This file is the source of truth for `@cct/core/attacks` and `@cct/core/invariants`. Every attack is data (an `AttackSpec`), not ad-hoc code.

## 1. Attack spec format

```ts
type AttackSpec = {
  id: "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9";
  name: string;
  priority: "must" | "should" | "could";
  bugClass: DiagnosisCategory;           // what it is designed to expose
  buyer: {
    product: string;                      // sku, e.g. "house-blend"
    qty: number;
    approve: boolean;                     // false = abandon in popup (order stays CREATED)
    tamper?: { path: "/api/orders"; field: "amount"; value: string };
    blockRequests?: string[];             // e.g. ["**/api/orders/*/capture"]
    afterApprove?: { call: "POST /api/orders/:id/fulfil" };
    doubleClick?: boolean;
  };
  webhookRules: WebhookRule[];           // F6
  faultRules: FaultRule[];               // F7
  expectedDeliveries: PayPalEventType[]; // what settle waits for
  invariants: InvariantId[];             // checked after settle
  settleSeconds?: number;                // default 60
  realVsSimulated: string;               // shown in UI and report
};
```

Event names used: `CHECKOUT.ORDER.APPROVED` ✅ (Orders v2 webhook reference), `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.PENDING` ⚠️ (from memory; S2 confirms by subscribing and observing real deliveries).

## 2. Invariants

All invariants are pure functions. "Truth" = the worker's direct `GET /v2/checkout/orders/{id}` after settle. "Store" = the state probe snapshot after settle. "Catalog" = the server-side catalog CCT knows for the target (BuggyBeans: `apps/buggybeans/src/catalog.json`, also served at `/__crashtest/catalog`).

| ID | Rule | Fails when (example) |
| --- | --- | --- |
| I1 | For each store order: PayPal shows at most one COMPLETED capture, and the store's recorded capture ID equals PayPal's | store recorded no capture ID or a different one |
| I2 | Entitlements for an order are granted **at most once**: `credits_granted ≤ qty × credits_per_item` | duplicate webhook granted 200 credits for one bag (expected 100) |
| I3 | Captured amount and currency equal `catalog price × qty` (BuggyBeans has no tax/shipping) | PayPal captured 0.01 USD for a 12.00 USD item |
| I4 | Store order status is consistent with PayPal status (table below) | PayPal capture COMPLETED, store says `failed` or `approved` |
| I5 | No entitlement exists for an order unless PayPal shows a COMPLETED capture for it | forged webhook granted credits for an order that was never paid |
| I6 | Every order with a COMPLETED capture at PayPal has its entitlement granted by the end of the settle window | money taken, no credits |
| I7 | If PayPal's capture failed or was declined, the store order is not `paid`, has no entitlement, and the buyer saw an error (`br-` step with error banner) | declined payment shown as success |

Status consistency (I4):

| PayPal truth | Allowed store status |
| --- | --- |
| order `CREATED` (not approved) | `created`, `abandoned` |
| order `APPROVED`, no capture | `approved`, `created` |
| capture `COMPLETED` | `paid`, `fulfilled` |
| capture `PENDING` | `pending_capture` |
| capture `DECLINED` / capture call failed at PayPal | `failed`, `created`, `approved` |

## 3. Attacks

### A1 — Duplicate webhook (Must)

| Field | Value |
| --- | --- |
| Targets bug | B1 missing dedupe |
| Buyer | buys `house-blend` ×1, approves |
| Webhook rules | `PAYMENT.CAPTURE.COMPLETED`: `duplicate {times: 3, gapMs: 400}`; others `pass` |
| Faults | none |
| Invariants | I2, I4, I5 |
| Buggy result | credits 300 (or 200) for one bag → **I2 fails** |
| Fixed result | credits 100; later deliveries answered 200 and ignored |
| Real vs simulated | real purchase; real signed delivery replayed byte-for-byte |
| Reference fix | store processed `event.id` with a unique constraint; grant inside the same transaction |

### A2 — Out-of-order events (Should)

| Field | Value |
| --- | --- |
| Targets bug | B2 non-monotonic order status |
| Buyer | buys `house-blend` ×1, approves |
| Webhook rules | hold `CHECKOUT.ORDER.APPROVED`; forward `PAYMENT.CAPTURE.COMPLETED` first; then release `CHECKOUT.ORDER.APPROVED` |
| Invariants | I4, I6 |
| Buggy result | store final status `approved` (regressed) and credits revoked or never shown → **I4 fails** |
| Fixed result | status stays `paid`; late APPROVED ignored |
| Reference fix | status only moves forward (rank table) or re-fetch order from PayPal on each event |

### A3 — Forged webhook (Must)

| Field | Value |
| --- | --- |
| Targets bug | B3 no signature verification |
| Buyer | starts checkout for `house-blend` ×1 and **abandons** in the popup (store order `created` with a real PayPal order ID) |
| Webhook rules | `forge`: `PAYMENT.CAPTURE.COMPLETED` for that PayPal order ID, random capture ID, invalid `PAYPAL-TRANSMISSION-SIG` |
| Invariants | I5, I4 |
| Buggy result | store marks the order `paid` and grants credits; PayPal truth shows `CREATED`, no capture → **I5 fails** |
| Fixed result | store calls verify-webhook-signature, gets non-SUCCESS, answers 400, nothing granted |
| Real vs simulated | the order is real; the webhook is forged by CCT (labelled) |
| Reference fix | verify every event with `POST /v1/notifications/verify-webhook-signature` (`webhook_id` = `PAYPAL_WEBHOOK_ID`) before acting, and re-fetch the order |

### A4 — Capture times out after success (Must)

| Field | Value |
| --- | --- |
| Targets bug | B4 capture failure handling |
| Buyer | buys `house-blend` ×1, approves |
| Faults | first `POST /v2/checkout/orders/{id}/capture`: `timeout_after_forward {ms: 15000}` → store gets `504` while PayPal captured |
| Webhook rules | `pass` |
| Invariants | I1, I4, I6 |
| Buggy result | store marks order `failed`, shows "payment failed", ignores the later COMPLETED webhook for a failed order; PayPal shows COMPLETED → **I4 and I6 fail** (customer charged, no credits) |
| Fixed result | store retries capture with the **same** `PayPal-Request-Id` (PayPal returns the earlier result ✅ doc example) or re-reads the order; marks `paid`, grants once |
| Real vs simulated | capture real; the timeout is injected by CCT (labelled) |
| Reference fix | `PayPal-Request-Id` per capture attempt (stable per order), retry on timeout/5xx, reconcile via GET order, webhook path idempotent |

### A5 — Price tampering (Must)

| Field | Value |
| --- | --- |
| Targets bug | B5 client amount trusted |
| Buyer | buys `house-blend` ×1 with tamper `amount = "0.01"` on `POST /api/orders` |
| Invariants | I3, I2 |
| Buggy result | PayPal captured 0.01 USD; store grants 100 credits → **I3 fails** |
| Fixed result | server ignores client amount, creates the order from the catalog (12.00 USD) |
| Real vs simulated | real purchase, tampered request from the browser |
| Reference fix | create order amounts on the server from `sku` and `qty` only |

### A6 — Fulfil without capture (Should)

| Field | Value |
| --- | --- |
| Targets bug | B6 client-triggered fulfilment |
| Buyer | approves; Playwright **blocks** the capture request, then calls `POST /api/orders/:id/fulfil` directly |
| Invariants | I5, I4 |
| Buggy result | credits granted; PayPal shows `APPROVED`, no capture → **I5 fails** |
| Fixed result | fulfil endpoint does not exist or checks PayPal capture `COMPLETED` first |
| Reference fix | fulfil only inside the server-side capture handler after `status === "COMPLETED"` |

### A7 — Declined capture (Must)

| Field | Value |
| --- | --- |
| Targets bug | B7 capture result not checked |
| Buyer | buys `house-blend` ×1, approves |
| Faults | first capture: `negative_test {code: "INSTRUMENT_DECLINED"}` ⚠️ (S5 confirms the code works on capture in our app; alternative codes recorded there) |
| Invariants | I7, I5 |
| Buggy result | store treats the capture call as done and grants credits; PayPal shows no completed capture → **I7 fails** |
| Fixed result | store checks HTTP status and `status === "COMPLETED"`; on `INSTRUMENT_DECLINED` shows an error and lets the buyer retry |
| Real vs simulated | PayPal returns the error itself through its negative-testing feature ✅ |
| Reference fix | strict result check; error UI; no grant on non-COMPLETED |

### A8 — Dropped webhooks (Should)

| Field | Value |
| --- | --- |
| Targets bug | B8 webhook-only fulfilment without reconciliation |
| Buyer | buys `house-blend` ×1, approves |
| Webhook rules | `drop` all for this order |
| Invariants | I6, I4 |
| Buggy result | PayPal COMPLETED, store `approved`, no credits → **I6 fails** |
| Fixed result | store fulfils from the capture response (idempotently) and/or reconciles pending orders via GET order |
| Reference fix | fulfil on capture response; webhook is a backup path; reconciliation job |

### A9 — Double submit (Could)

Buyer double-clicks the confirm control so two capture requests race. Checks I1, I2. Exposes stores that grant on each capture response (relevant with B7 enabled). Expected PayPal behaviour for a second capture of the same order is ⚠️ (S4 records it).

## 4. Seeded bugs (BuggyBeans) and expected mapping

| Bug | What the code does wrong | Exposed by | Failing invariants | Diagnosis category |
| --- | --- | --- | --- | --- |
| B1 | grants credits on every `PAYMENT.CAPTURE.COMPLETED` delivery, no dedupe | A1 | I2 | `missing_dedupe` |
| B2 | sets order status to whatever the latest event says | A2 | I4 | `ordering` |
| B3 | trusts webhook bodies without signature verification | A3 | I5 | `no_signature_check` |
| B4 | marks order `failed` on capture timeout/5xx, no retry with `PayPal-Request-Id`, ignores later events for failed orders | A4 | I4, I6 | `capture_retry` |
| B5 | uses the client-sent amount when creating the PayPal order | A5 | I3 | `client_amount_trusted` |
| B6 | exposes `POST /api/orders/:id/fulfil` that grants without checking capture | A6 | I5 | `fulfil_without_capture` |
| B7 | grants credits after the capture call returns, without checking status | A7 | I7 | `decline_handled_as_success` |
| B8 | fulfils only on webhook; no reconciliation | A8 | I6 | `webhook_only_fulfilment` |

Consistency rule used by F13: a diagnosis is accepted only if its category is in the "allowed categories" for the failed invariants:

| Failed invariant | Allowed categories |
| --- | --- |
| I1 | `capture_retry`, `missing_dedupe`, `other` |
| I2 | `missing_dedupe`, `decline_handled_as_success`, `other` |
| I3 | `client_amount_trusted`, `other` |
| I4 | `ordering`, `capture_retry`, `webhook_only_fulfilment`, `no_signature_check`, `fulfil_without_capture`, `other` |
| I5 | `no_signature_check`, `fulfil_without_capture`, `other` |
| I6 | `capture_retry`, `webhook_only_fulfilment`, `other` |
| I7 | `decline_handled_as_success`, `other` |

`other` is allowed but counted as a miss in the eval's category accuracy.

**Bug interactions:** B8 changes the fulfilment path, so with B8 on, A1 may not expose B1 (no webhook grant path difference). The demo preset is `B1,B3,B4,B5,B7`. The `all` preset documents interactions in its run notes.

## 5. Expected results matrix (acceptance baseline)

| Attack | `BUGS=none` | Its own bug only | Demo preset |
| --- | --- | --- | --- |
| A1 | all pass | I2 fail | I2 fail |
| A2 | all pass | I4 fail | pass (B2 off) |
| A3 | all pass | I5 fail | I5 fail |
| A4 | all pass | I4, I6 fail | I4, I6 fail |
| A5 | all pass | I3 fail | I3 fail |
| A6 | all pass | I5 fail | pass (B6 off) |
| A7 | all pass | I7 fail | I7 fail |
| A8 | all pass | I6 fail | pass (B8 off) |

This matrix is executed by `pnpm eval:bugs` and is acceptance criterion AC-41.

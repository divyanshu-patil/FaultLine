# 22. Agent prompt — integrate FaultLine into your store

Paste the block below to your coding agent (Claude Code, Cursor, …) **with your store's repository open**. It implements the FaultLine contract (docs/21) in your stack so you can run `npx faultline test` against it. Everything is **PayPal sandbox only**.

---

> You are adding support for **FaultLine**, a sandbox-only crash-tester for PayPal checkout integrations. Implement the small HTTP contract below in **this** store so FaultLine can drive a purchase, disturb the webhooks, read the store's state and grade it with deterministic checks. Do not change business logic beyond what's described; only add these endpoints and configuration. Match the store's existing framework, style and auth. **PayPal sandbox only — never wire any of this to live PayPal.**
>
> **Configuration**
> - Make the PayPal API base configurable via `PAYPAL_API_BASE` (FaultLine points it at its simulated PayPal) and the webhook id via `PAYPAL_WEBHOOK_ID`.
> - Add a `PROBE_TOKEN` env var (a random ≥16-char secret).
>
> **Endpoints**
> 1. `POST /api/orders` — body `{ "sku": string, "qty": number, "amount"?: string }`. Price the order from **your own catalog × qty** and **ignore any client-supplied `amount`** (trusting it is exactly the bug FaultLine tests). Create the PayPal order against `PAYPAL_API_BASE` and respond `{ "id": "<the PayPal order id>" }`.
> 2. `POST /api/orders/{paypalOrderId}/capture` — capture the order against PayPal; respond `{ "status": "COMPLETED" }` on success, and a non-`COMPLETED` status or error body when PayPal declines.
> 3. `POST /webhooks/paypal` — receive PayPal webhook deliveries; **verify the signature** by calling `POST {PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`, and only then update state. Be **idempotent** (the same event may arrive more than once), and tolerate **out-of-order** and **missing** deliveries.
> 4. `GET /__crashtest/state` — require `Authorization: Bearer <PROBE_TOKEN>` with a **constant-time** compare (401 otherwise). Return a **read-only** snapshot (no mutation, no PII):
>    ```json
>    {
>      "storeTime": "<ISO timestamp>",
>      "orders": [{ "storeOrderId": "", "paypalOrderId": "", "sku": "", "qty": 1, "status": "", "captureId": "", "amount": "", "currency": "USD", "updatedAt": "" }],
>      "entitlements": [{ "storeOrderId": "", "credits": 0, "source": "", "grantedAt": "", "ref": "" }],
>      "webhookEvents": [{ "eventId": "", "type": "", "receivedAt": "", "outcome": "" }]
>    }
>    ```
>    `entitlements` is whatever you grant on payment (credits, licences, shipped goods), modelled as a credit count per order.
> 5. Do **not** expose a fulfil-without-capture route in production; if one exists for testing it must return `404`.
>
> **Correctness to preserve** (FaultLine checks these): grant credits/fulfilment **exactly once**, **only after a verified capture**, for the amount **PayPal actually captured** — never from an unverified or duplicated webhook, and never for a client-chosen price.
>
> When you're done, tell me the store's base URL, the probe token, and the framework you used, and give me the exact command to run:
> `npx faultline test --store <url> --probe-token <token> --paypal-port 4500 --proxy-port 4510`

---

The bundled reference implementation of this contract is `apps/buggybeans` in the FaultLine repo — point your agent at `src/routes/orders.ts`, `src/routes/webhooks.ts` and `src/routes/probe.ts` if it wants a worked example.

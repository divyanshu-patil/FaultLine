# 07. PayPal integration (what we may rely on)

This is the only list of PayPal behaviour the code may depend on. If something is not here, it is not allowed until a spike confirms it and this file is updated.

Legend: ✅ read in PayPal docs (date given) · ⚠️ memory or third-party · ❓ unverified / conflicting.

## 1. Environment

| Item | Value | Status |
| --- | --- | --- |
| REST host | `https://api-m.sandbox.paypal.com` | ✅ (used in PayPal's negative-testing and authorization examples, 2026-10-19) |
| Production host | **never used**; CI fails if it appears | rule |
| Dashboard | developer.paypal.com → Apps & Credentials (Sandbox) | ⚠️ UI labels |
| Accounts | one sandbox **business** account (the store), one sandbox **personal** account (the buyer) | ⚠️ default sandbox accounts may already exist |
| REST app | sandbox app owned by the business account; gives client ID + secret | ✅ concept |

Two sandbox apps are recommended: `faultline-buggybeans` (used by all BuggyBeans instances; its webhook points at the engine) and, if you test an external store, that store's own app.

## 2. OAuth

- `POST /v1/oauth2/token`, HTTP Basic (`client_id:secret`), body `grant_type=client_credentials` ⚠️ (standard; confirm in S0).
- Cache the token until `expires_in − 300 s`; refresh on 401 once.
- BuggyBeans has its own small client (it imitates a third-party store); FaultLine's truth reader uses `@faultline/paypal`.

## 3. Orders v2

| Call | Used by | Contract | Status |
| --- | --- | --- | --- |
| Create order `POST /v2/checkout/orders` | BuggyBeans (via fault proxy) | `{intent:"CAPTURE", purchase_units:[{reference_id, amount:{currency_code:"USD", value:"12.00"}}]}` → `201 {id, status:"CREATED", links}` | ⚠️ body shape (standard); S0 confirms |
| Capture `POST /v2/checkout/orders/{id}/capture` | BuggyBeans (via fault proxy) | empty JSON body; header `PayPal-Request-Id` in the fixed store → `201 {status:"COMPLETED", purchase_units[0].payments.captures[0].{id,status,amount}}` | ⚠️ shape; S0 |
| Show order `GET /v2/checkout/orders/{id}` | FaultLine truth reader (direct) | `status` (`CREATED`, `APPROVED`, `COMPLETED`, …), captures | ⚠️ shape; S0 |
| Negative testing on create/capture/show | fault proxy | header `PayPal-Mock-Response: {"mock_application_codes":"<CODE>"}` | ✅ (Orders v2 create, update, show, authorize, capture listed, 2026-10-19) |

Capture outcomes FaultLine must understand:
- `201` + `status: COMPLETED` → captured.
- `422` with an issue code (e.g. `INSTRUMENT_DECLINED` ⚠️, `ORDER_ALREADY_CAPTURED` ⚠️) → not captured this call. S4/S5 record the exact codes observed.
- Timeout/5xx → unknown; must reconcile with `GET` order.

## 4. JS SDK (BuggyBeans storefront)

- BuggyBeans uses the standard PayPal JavaScript SDK buttons with `createOrder` → `POST /api/orders` and `onApprove` → `POST /api/orders/:id/capture` ⚠️ (common v5 pattern). The script URL takes the sandbox client ID ⚠️.
- JS SDK v6 exists, with an official v5→v6 upgrade guide and a beta AI upgrade assistant (VS Code) ✅ (PayPal blog, 2025-10-09). BuggyBeans stays on the v5 pattern because most existing integrations use it ⚠️; note this in the README. A v6 BuggyBeans variant is Could.
- On `INSTRUMENT_DECLINED` the fixed store restarts the flow so the buyer can choose another funding source ⚠️ (documented pattern; confirm in S5).

## 5. Webhooks

| Item | Contract | Status |
| --- | --- | --- |
| Events subscribed on the `faultline-buggybeans` app | `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.PENDING` | `CHECKOUT.ORDER.APPROVED` ✅ (Orders v2 event reference, 2026-10-19); capture events ⚠️ |
| URL | `https://<engine>/hooks/paypal` (HTTPS, port 443) | simulator requires HTTPS 443 ✅ |
| Verify | `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time`, `webhook_id`, `webhook_event`; success is `verification_status: "SUCCESS"` | ✅ (2026-10-17) |
| Headers on deliveries | `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`, `PAYPAL-TRANSMISSION-SIG` | ✅ (2026-10-17) |
| Retries | up to 25 attempts over about 3 days, exponential backoff | ⚠️ (Hookdeck guide, 2026-10-19) |
| Ordering | not guaranteed | ⚠️ (Hookdeck quoting PayPal, 2026-10-19) |
| Duplicates | possible due to retries; dedupe on event `id` | ⚠️ (Hookdeck, 2026-10-19) |
| Receiver | respond 2xx promptly, process asynchronously | ⚠️ (Hookdeck, 2026-10-19) |
| Simulator | posts mock events to any HTTPS:443 URL; events "cannot be verified" by the postback, are "not associated with any App", "cannot be resent" | ✅ (simulator page, 2026-10-19) |
| Simulate-event API | Webhooks Management API has a simulate-event endpoint | ✅ (2026-10-19). Used only in plumbing tests |
| Capture → order link | `resource.supplementary_data.related_ids.order_id` on capture events | ⚠️ S2 |
| Replay of a real delivery re-verifies | — | ❓ S3 |

FaultLine never treats a simulator event as a real payment, and labels simulator use in the UI.

## 6. Idempotency

- Header `PayPal-Request-Id`. PayPal stores the ID "for a period of time"; a retry with the same ID returns the earlier result instead of repeating the action; PayPal's own example is a capture that already succeeded ✅ (idempotency page, 2026-10-19).
- "Not all APIs support this header" ✅. Orders v2 capture support ⚠️ — S4 confirms by sending the same capture twice with the same ID and recording both responses.
- Retention period ❓ (not stated on the page).

## 7. Negative testing

- Add `PayPal-Mock-Response` with `mock_application_codes` to make the sandbox return that error ✅ (2026-10-19).
- Supported (from the page): Payments v1 create/execute; Payments v2 show/capture/void authorization, show capture, refund, show refund; Orders v2 create, update, show, authorize, capture ✅.
- Codes: the page's example is `DUPLICATE_INVOICE_ID`; the full list is in the Orders API error reference ✅ (pointer). Codes FaultLine wants: `INSTRUMENT_DECLINED`, `TRANSACTION_REFUSED`, `ORDER_NOT_APPROVED` ⚠️ — S5 records which ones work on capture for our app.
- Whether negative testing needs to be enabled on the sandbox account ❓ (the page describes the header alone) — S5.

## 8. Allowlist (`@faultline/paypal/allowlist` and the fault proxy)

| Method | Path | Who |
| --- | --- | --- |
| POST | `/v1/oauth2/token` | proxy (store), truth reader |
| POST | `/v2/checkout/orders` | proxy (store) |
| GET | `/v2/checkout/orders/{id}` | proxy (store), truth reader |
| POST | `/v2/checkout/orders/{id}/capture` | proxy (store) |
| POST | `/v1/notifications/verify-webhook-signature` | proxy (store), FaultLine tests |
| POST | `/v1/notifications/simulate-event` ⚠️ path | plumbing tests only |
| POST | `/v2/checkout/orders/{id}/confirm-payment-source` | buyer approval strategy `card` only (worker, never via the store) |
| GET/POST/PATCH | `/v1/notifications/webhooks[/{id}]` | `pnpm setup:webhook` only (registers the FaultLine webhook; never touches other webhooks on the app) |

Anything else → `403 UPSTREAM_PATH_NOT_ALLOWED`. Host is fixed to the sandbox host; any other host fails at boot.

## 8a. Observed in spikes (2026-10-19)

- Capture before approval → `422`, `details[0].issue = "ORDER_NOT_APPROVED"` ✅.
- Negative testing works on capture regardless of approval: `422 INSTRUMENT_DECLINED` ✅ (S5).
- `confirm-payment-source` with a card needs the business account enabled for card processing; ours is not (`PAYER_CANNOT_PAY` / `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`) ✅.
- `verify-webhook-signature` validates field formats first: a `webhook_id` or `transmission_id` with invalid characters → `400 INVALID_REQUEST` ✅. Forged templates therefore use well-formed IDs so the store's postback reaches the signature check.
- Response header `paypal-debug-id` is present ✅.

## 9. Rate limits and errors

- PayPal sandbox rate limits ❓; the hosted demo makes ~4–8 API calls per attack. On `429`, honour `Retry-After` if present ⚠️; an attack that hits a rate limit is `infra_error`, never a finding.
- Sandbox UI is slower than production and Playwright flows against it are flaky-prone ⚠️ (tessl registry note, 2026-10-19): use generous timeouts (popup 45 s) and retry the buyer flow once on infra errors, recording both tries.

## 10. Not used

Authorizations/void, refunds, subscriptions, payouts, disputes, vault, Braintree, Venmo, Agent Toolkit. (The Agent Toolkit has order tools but no webhook tooling and is not needed; using our own client keeps the allowlist simple.)

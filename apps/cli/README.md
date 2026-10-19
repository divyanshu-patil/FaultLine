# faultline

Crash-test a PayPal checkout integration — duplicate, out-of-order and dropped webhooks, a tampered price, a fulfil-without-capture, a declined payment — and get a **deterministic pass/fail** per invariant. **Sandbox only.** Verdicts come from checks against PayPal's own record, never from an AI.

```bash
npx faultline test \
  --store https://your-store.example \
  --probe-token "$PROBE_TOKEN" \
  --paypal-port 4500 --proxy-port 4510 \
  --attacks A1,A2,A5,A6,A7,A8
```

```
Simulated PayPal (sandbox): http://127.0.0.1:4500   ← point your store's PAYPAL_API_BASE here

ATTACK  RESULT
A5      BUG — failed I3  (Price tampering)
A7      ok — no invariant failed
...
1 bug found, 0 attacks errored, of 6 run. Sandbox only.
```

## How it works

`faultline` runs a **simulated PayPal** and a **webhook-disturbance proxy** on your machine. Your store is configured to call that simulated PayPal; FaultLine drives a purchase through your store's own endpoints, disturbs the webhooks on the way back, reads your store's internal state through a read-only probe, and compares it to PayPal's record. Nothing leaves your machine, and no live buyer approval is needed.

## Your store implements a small contract

- `POST /api/orders` `{sku, qty, amount?}` → `{id}` (price from your catalog; ignore client `amount`)
- `POST /api/orders/{id}/capture` → `{status}`
- `POST /webhooks/paypal` (verify signature; be idempotent; tolerate reorder/drop)
- `GET /__crashtest/state` (Bearer `PROBE_TOKEN`; read-only snapshot of orders / entitlements / webhook events)

Set your store's `PAYPAL_API_BASE` to the simulated-PayPal URL the CLI prints, `PAYPAL_WEBHOOK_ID` to the id it prints, and `PROBE_TOKEN` to the token you pass the CLI. No real PayPal credentials are needed on the simulated backend.

**Want your coding agent to implement the contract for you?** Paste the prompt in [docs/22](https://github.com/divyanshu-patil/FaultLine/blob/main/docs/22-agent-integration-prompt.md) to Claude Code / Cursor with your repo open.

## Commands & flags

- `faultline test --store <url> --probe-token <token>` — run the crash test.
  - `--attacks A1,A5,…` (default: A1,A2,A5,A6,A7,A8) · `--sku <sku>` · `--host <host>` (bind address if your store is on another machine) · `--paypal-port <n>` / `--proxy-port <n>` (keep stable so your store's config stays valid) · `--json` · `--fail-on-findings` (exit non-zero if any bug is found — for CI gates)
- `faultline attacks` — list the attacks that run externally.

`A3` (forged event) and `A4` (withheld capture response) need operator hooks and are not part of the external set.

## Full docs

Contract, exact request/response shapes, security notes and the reference store: **[docs/21 — Integrate your store](https://github.com/divyanshu-patil/FaultLine/blob/main/docs/21-integrate-your-store.md)**.

MIT licensed. Built for the PayPal AI Hackathon.

# 17. Runbook — how to set up, run and deploy

UI labels in third-party dashboards change; where a step says ⚠️, look for the nearest equivalent.

## 1. Prerequisites

- Node 22 LTS ⚠️, pnpm 9+ ⚠️, Git.
- Docker (optional, for local Postgres).
- A tunnel tool: `cloudflared` or `ngrok` (PayPal must reach your engine over HTTPS on port 443 ✅ simulator requirement; real webhooks need a public HTTPS URL too).
- Accounts: PayPal Developer, Supabase, Ollama, Render, GitHub.

## 2. PayPal sandbox setup

1. Log in at developer.paypal.com → **Testing tools → Sandbox accounts** ⚠️. Ensure you have one **Business** and one **Personal** sandbox account. Note the personal account's email and password (they become `SANDBOX_BUYER_EMAIL` / `SANDBOX_BUYER_PASSWORD`).
2. **Apps & Credentials → Sandbox → Create App** ⚠️ named `faultline-buggybeans`, linked to the business sandbox account. Copy client ID and secret → `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.
3. Start your tunnel first (§5 step 4) to get the public engine URL.
4. In the app: **Add webhook** ⚠️ with URL `https://<engine-public-url>/hooks/paypal`, events: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.PENDING`. Copy the **Webhook ID** → `PAYPAL_WEBHOOK_ID`.
5. Quick check (S0): get a token and create an order with curl:
   ```bash
   curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" \
     -d grant_type=client_credentials https://api-m.sandbox.paypal.com/v1/oauth2/token
   ```

When the tunnel URL changes (free tunnels change on restart), update the webhook URL in the app. A named/reserved tunnel avoids this.

## 3. Supabase

1. Create a project (region near you). Settings → Database → **Connection string → Session pooler** (port 5432) ⚠️ → `DATABASE_URL`. Do **not** use the transaction pooler (6543).
2. `pnpm db:migrate` creates tables (RLS enabled, no policies).
3. `pnpm seed`.

Local alternative: `docker compose -f infra/docker-compose.yml up -d` and `DATABASE_URL=postgres://faultline:faultline@localhost:5432/faultline`.

## 4. Ollama Cloud

1. Create an API key on ollama.com ⚠️ → `OLLAMA_API_KEY`.
2. Check the model ID:
   ```bash
   curl -s -H "Authorization: Bearer $OLLAMA_API_KEY" https://ollama.com/api/tags | jq '.models[].name' | grep -i gemma
   ```
   Set `OLLAMA_MODEL` to the Gemma 4 31B entry (expected `gemma4:31b` ⚠️).
3. Smoke test:
   ```bash
   curl -s https://ollama.com/api/chat -H "Authorization: Bearer $OLLAMA_API_KEY" \
     -d '{"model":"'"$OLLAMA_MODEL"'","stream":false,"messages":[{"role":"user","content":"Reply with {\"ok\":true}"}]}'
   ```

## 5. Run locally

```bash
git clone <repo> && cd faultline
pnpm install
cp .env.example .env        # fill every value (docs/03 §5)
pnpm db:migrate && pnpm seed
cloudflared tunnel --url http://localhost:4100      # engine port; copy the https URL
# put that URL in .env as PUBLIC_BASE_URL and in the PayPal webhook (§2.4)
pnpm dev                    # web :3000, api :4000, engine :4100, buggybeans-public :4200
```

Open http://localhost:3000 → log in with a code from `ACCESS_CODES` → **Run the demo crash test**.

Checklist mode without any AI key: choose **Checklist** on the new-run page.

## 6. CLI (Should)

```bash
FAULTLINE_API=http://localhost:4000 FAULTLINE_ACCESS_CODE=... pnpm faultline -- run --target buggybeans:demo --mode agent --wait
pnpm faultline -- report <runId> --md > report.md
```

## 7. Deploy (Render + Supabase)

1. Create a production Supabase project; run migrations against it; seed.
2. Render → **New Blueprint** ⚠️ → point at the repo (`infra/render.yaml`). Services: `faultline-web`, `faultline-api`, `faultline-engine` (plan `1c-2g`), `buggybeans-public`.
3. Set env vars per service (`docs/03` §5). Secrets as "sync: false" values entered in the dashboard ⚠️.
4. After `faultline-engine` is live, set `PUBLIC_BASE_URL` to its URL and update the PayPal sandbox webhook URL to `https://<faultline-engine>/hooks/paypal`.
5. `faultline-web` env `API_ORIGIN=https://<faultline-api>`.
6. Run `pnpm demo:rehearse --times 5 --base-url https://<faultline-web>`.
7. Create the pinned demo report: run once, then mark it pinned (`pnpm faultline -- pin <runId>` or SQL).

Playwright on Render: install Chromium in the engine build (`pnpm exec playwright install --with-deps chromium` ⚠️ may need a Docker-based service if system deps are missing; S7 decides native vs Docker runtime).

## 8. Operate

- Logs: Render dashboard per service; search by `runId`.
- Stuck run: it is reclaimed after the job lease (120 s) if the engine restarted; otherwise cancel from the UI.
- Clean up: the `cleanup` job runs every 10 min; manual: `pnpm faultline -- cleanup`.
- Rotate access codes: change `ACCESS_CODES` on `faultline-api` and redeploy.
- Keep Supabase awake: the engine pings `GET /api/health?db=1` every 6 h.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No webhooks arrive | webhook URL points at an old tunnel; engine asleep | update URL in the PayPal app; use a paid engine instance |
| Deliveries stored but "uncorrelated" | order created outside FaultLine, or order-id path differs (S2) | check `paypal_calls` for the order; update correlation path |
| Store rejects every webhook in fixed mode | wrong `PAYPAL_WEBHOOK_ID` | copy the ID from the app's webhook list |
| Buyer stuck at PayPal login | captcha / UI change | switch to FB1 stored login state; update selectors file |
| Capture returns 422 on fixed store | order not approved; sandbox account issue | inspect `pc-` evidence; re-run buyer |
| Agent runs degrade to checklist | Ollama key/model wrong, rate limited | check `/api/tags`; check `model_calls.outcome` |
| Patched instance build fails often | patch prompt too loose | inspect guard/build output in finding page; tighten prompt |
| `prepared statement` or lock errors | DB URL uses port 6543 | use session pooler 5432 |
| Engine OOM | Chromium + instances | larger plan; lower `MAX_LIVE_INSTANCES` |

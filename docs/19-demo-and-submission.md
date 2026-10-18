# 19. Demo video and submission

## 1. Video storyboard (target 2:50, hard limit < 3:00 ✅)

Record the hosted app at 1080p. Use voice-over, no copyrighted music. Show real sandbox IDs on screen at least once. Prefer a real live run; if a step is slow, cut time but never fake a result.

| Time | Screen | Voice-over (draft) |
| --- | --- | --- |
| 0:00–0:15 | BuggyBeans store, a purchase completes | "This coffee shop takes PayPal. Its happy path works. But PayPal webhooks can arrive twice, late, or out of order, and networks time out. What does this store do then?" |
| 0:15–0:30 | CCT home → Run demo crash test (agent) | "Checkout Crash Test is an AI agent that shops at your store to break it, using only PayPal sandbox money." |
| 0:30–0:50 | Recon suspects table | "First it reads the store's payment code and lists suspects: no signature check, no dedupe, no retry with a PayPal-Request-Id." |
| 0:50–1:30 | Live timeline for A4: buyer pays in the PayPal popup; proxy injects a timeout after PayPal captured; invariant board turns red (I4, I6) | "The agent picks the nastiest one. A real buyer pays. PayPal captures. CCT cuts the response on the way back. The store thinks the payment failed. PayPal's own record says COMPLETED. The customer was charged and got no coffee. The verdict comes from code, comparing PayPal's record with the store's, not from the AI." |
| 1:30–1:55 | Finding page: diagnosis with evidence chips; patch diff | "The AI explains the cause, citing exact evidence IDs from the trace, and writes a small patch: retry with the same PayPal-Request-Id and reconcile with the order." |
| 1:55–2:15 | Proof cards: same attack on a fresh patched store → green | "Then it proves the fix. Fresh store, same attack, same PayPal sandbox. Green." |
| 2:15–2:35 | Montage: A1 duplicate webhook (credits ×3), A3 forged webhook, A5 $0.01 price, A7 declined capture via PayPal negative testing | "Same loop for duplicate webhooks, forged webhooks, price tampering and declined payments." |
| 2:35–2:50 | Report page; eval numbers; repo | "Every run ends in a shareable report. Measured on our seeded store: [numbers from eval with date]. Open source, sandbox only." |

Checklist: SANDBOX badge visible; one PayPal order ID visible; "AI explanation" vs "checker verdict" labels visible; no secrets on screen; no browser bookmarks or personal info visible.

## 2. Devpost text (draft — replace bracketed values with measured ones)

**Name:** Checkout Crash Test

**Tagline:** An AI agent that shops at your store to break it, then proves the fix, on PayPal sandbox.

**Inspiration:** PayPal webhooks can be delivered more than once and out of order, and capture calls can time out after the money moved. Most integrations are only tested on the happy path. We wanted a tool that tests the unhappy paths with real PayPal traffic, and that never lets the AI grade its own work.

**What it does:**
- An AI agent (Gemma 4 31B on Ollama Cloud) reads a store's payment code and suspects bugs.
- It runs attacks with real PayPal sandbox purchases: duplicate, out-of-order and forged webhooks; a capture that times out after PayPal captured; price tampering; declined captures using PayPal's negative testing.
- Deterministic checks compare PayPal's order record with the store's records and decide pass/fail.
- For each failure, the agent explains the cause, citing evidence IDs from the trace, and writes a patch.
- CCT runs the same attack on a fresh copy of the store with the patch, and shows before/after.

**How we built it:** Turborepo; Next.js UI; Express services (API, a webhook chaos proxy and PayPal fault proxy, a worker with Playwright); Supabase Postgres; Ollama Cloud; PayPal Orders v2, webhooks, verify-webhook-signature, `PayPal-Request-Id`, negative testing; hosted on Render.

**Challenges:** [fill: e.g. automating the sandbox popup, correlating webhooks to test runs, keeping AI evidence honest]

**Accomplishments:** [measured numbers: bugs found, attacks used vs checklist, AI patches verified, evidence validity] (date, model ID).

**What we learned:** [fill]

**What's next:** GitHub App that opens PRs with proven patches; more attack types (refunds, authorizations); verified external targets.

**Built with:** paypal, orders-v2, webhooks, ollama, gemma, nextjs, express, typescript, turborepo, supabase, postgresql, playwright, render.

**Testing instructions:** Hosted demo `<url>`, access code `<code>`. Click "Run the demo crash test". A run takes about [N] minutes; a finished example report: `<report url>`. Local: see README (needs your own PayPal sandbox app, Supabase or Docker Postgres, and optionally an Ollama key; checklist mode needs no AI key).

**New project statement:** Built from scratch starting 19 Oct 2026 during the submission period.

## 3. Images for the gallery

1. Live run view with red invariant board.
2. Finding page with diagnosis + diff.
3. Proof cards red → green.
4. Architecture diagram.
5. Report page.

## 4. Submission checklist

See `docs/16` §5 (pre-submission). Submit by **Wed 11 Nov 18:00 IST**; deadline Fri 13 Nov 01:30 IST.

# 01. Product brief

## 1. One line

An AI agent that shops at your store to break it, then proves the fix, using only PayPal sandbox money.

## 2. Explain it to a child

Imagine you have a little toy shop. When a friend pays, a message flies over saying "they paid!", and you give them a sticker. Sometimes the message arrives twice by mistake, and you give two stickers instead of one. Checkout Crash Test is a friendly robot that pretends to be a shopper. It plays tricky games with your shop, like sending the "they paid!" message twice or saying a toy costs one penny, to see if your shop gets confused. When it finds a mistake, it shows you exactly what went wrong and how to fix it. Then it plays the same trick again to check the shop is fixed. Nobody uses real money, only pretend money.

## 3. The user

**Primary:** a developer at a small business or agency who integrates PayPal Checkout (Orders v2 + webhooks) into a web store, SaaS or digital-goods app, and ships without a QA team.

Their situation:
- Their happy path works: a sandbox purchase succeeds once.
- They have never tested what happens when PayPal delivers the same webhook twice, delivers events out of order, or when a capture call times out after PayPal already took the money.
- These failures show up in production as double-granted credits, customers charged without receiving goods, or orders stuck in "pending".

**Secondary:** PayPal's own developer-experience team, who benefit when integrations are correct (fewer support tickets and disputes). This matters because PayPal engineers judge the hackathon.

## 4. The problem (sourced)

- PayPal webhook deliveries are retried and can be duplicated; delivery order is not guaranteed; receivers must respond promptly and process asynchronously (Hookdeck's PayPal webhook guide ✅ 2026-10-19; consistent with PayPal webhook docs ⚠️).
- PayPal documents the idempotency header `PayPal-Request-Id` precisely because retries after network failures can repeat side effects; its own example is a capture that succeeded on the first call ✅.
- PayPal provides negative testing because integrations must handle errors such as declined captures ✅.
- PayPal's webhook simulator events "cannot be verified" by the verify-signature postback and are "not associated with any App" ✅, so developers who test only with the simulator never exercise real verification or real duplicates.

What we do **not** have and must not invent: a statistic of how many integrations have these bugs. The Impact story uses the documented hazards above plus our own measured results on seeded bugs (`docs/15-test-plan.md` §6). If you find a sourced statistic later, add it with source and date.

## 5. The product in one flow

1. Pick a target (the bundled BuggyBeans store, or your own sandbox store after verification).
2. Press **Crash test**.
3. Recon: the agent reads the store's PayPal-related code and lists suspects ("webhook handler may not deduplicate").
4. Attack: the agent chooses attacks. A browser buyer completes a real sandbox purchase; the proxies duplicate, reorder, forge, delay or fault PayPal traffic.
5. Verdict: deterministic invariants compare PayPal's record with the store's record.
6. Finding: for each failure, the agent explains the root cause citing trace IDs and writes a patch.
7. Proof: CCT starts a fresh copy of the store with the patch and re-runs the same attack. Red turns green, or the patch is rejected.
8. Report: a shareable page with findings, evidence, patches and before/after results.

## 6. Scope

### In scope (MVP)

- Orders v2 with `intent: CAPTURE`, PayPal JS SDK buttons, server-side create and capture.
- Webhooks for order approval and capture events, with signature verification via PayPal's postback.
- Attacks A1, A3, A4, A5, A7 (Must) and A2, A6, A8 (Should) from `docs/05-attack-catalog.md`.
- Invariants I1–I7.
- BuggyBeans victim store with seeded bugs B1–B8.
- Agent mode (Gemma 4 31B on Ollama Cloud) and checklist mode (no AI).
- Patch-and-verify loop on BuggyBeans.
- Hosted demo on Render and a local `docker compose` route.

### Out of scope (say so in the README)

- Production PayPal. Any non-sandbox host.
- Attacking stores that are not verified as owned by the user.
- Authorize/void flows, subscriptions, payouts, disputes, vaulting, Braintree.
- Applying patches to a user's repository. CCT shows the patch; the user merges it.
- Load testing or denial-of-service style traffic.
- Card-number handling of any kind beyond PayPal's own hosted UI.

## 7. Non-goals

- Not a general web security scanner.
- Not a replacement for PayPal's integration review.
- Not an autonomous code fixer for arbitrary codebases.

## 8. Success measures (for the hackathon)

| Measure | Target | How measured |
| --- | --- | --- |
| Seeded bug detection, agent mode | finds all enabled Must bugs (B1, B3, B4, B5, B7) on the demo config | eval suite `pnpm eval:bugs` |
| False positives on fixed store | 0 failed invariants | run every attack against `BUGS=none` |
| Attacks to find all bugs | agent uses fewer attacks than checklist mode on the demo config | eval report |
| Evidence integrity | 100% of diagnosis evidence IDs exist in the trace | `validateEvidenceRefs` metric |
| Patch success | ≥ 3 of 5 Must bugs fixed by an AI patch verified by re-run; the rest show the reference fix, labelled | eval report |
| Demo reliability | the 3-minute demo scenario passes 5 times in a row from fresh state | `pnpm demo:rehearse` |

Targets are the author's judgement, not promises.

## 9. Why PayPal is central

Every verdict depends on PayPal: real sandbox orders, real captures, real webhook deliveries with real signatures, PayPal's negative testing for declines, and PayPal's order and capture records as ground truth. Remove PayPal and there is nothing to test.

## 10. Why AI is central (and where it is not)

- AI chooses which attacks to run based on the store's code (agentic planning).
- AI explains failures from evidence and writes patches.
- AI drives an unfamiliar storefront (Should-have explore mode).
- AI never decides pass/fail, never touches non-sandbox hosts, never edits real code.

## 11. Open questions for the owner

1. Team size and weekly hours (the plan assumes one full-time developer; see `13`).
2. Licence choice (MIT recommended) and the name/organisation for the licence and Devpost.
3. Eligibility check against the official rules (country, age) — `judging.md` §1.
4. Whether to spend Render credits on a paid worker for the 1–15 Dec judging window.
5. Whether to enable Jev/Laya (cost after Laya's free period ends 31 Oct 2026 ✅).

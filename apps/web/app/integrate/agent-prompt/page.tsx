"use client";

import Link from "next/link";
import { useState } from "react";

const PROMPT = `You are adding support for FaultLine, a sandbox-only crash-tester for PayPal checkout integrations. Implement the small HTTP contract below in THIS store so FaultLine can drive a purchase, disturb the webhooks, read the store's state and grade it with deterministic checks. Do not change business logic beyond what's described; only add these endpoints and configuration. Match the store's existing framework, style and auth. PayPal sandbox only — never wire any of this to live PayPal.

Configuration
- Make the PayPal API base configurable via PAYPAL_API_BASE (FaultLine points it at its simulated PayPal) and the webhook id via PAYPAL_WEBHOOK_ID.
- Add a PROBE_TOKEN env var (a random >=16-char secret).

Endpoints
1. POST /api/orders — body {"sku": string, "qty": number, "amount"?: string}. Price the order from your own catalog x qty and IGNORE any client-supplied "amount" (trusting it is exactly the bug FaultLine tests). Create the PayPal order against PAYPAL_API_BASE and respond {"id": "<the PayPal order id>"}.
2. POST /api/orders/{paypalOrderId}/capture — capture the order against PayPal; respond {"status": "COMPLETED"} on success, and a non-COMPLETED status or error body when PayPal declines.
3. POST /webhooks/paypal — receive PayPal webhook deliveries; VERIFY the signature by calling POST {PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature with PAYPAL_WEBHOOK_ID, and only then update state. Be IDEMPOTENT (the same event may arrive more than once), and tolerate OUT-OF-ORDER and MISSING deliveries.
4. GET /__crashtest/state — require Authorization: Bearer <PROBE_TOKEN> with a constant-time compare (401 otherwise). Return a READ-ONLY snapshot (no mutation, no PII):
   {
     "storeTime": "<ISO timestamp>",
     "orders": [{ "storeOrderId": "", "paypalOrderId": "", "sku": "", "qty": 1, "status": "", "captureId": "", "amount": "", "currency": "USD", "updatedAt": "" }],
     "entitlements": [{ "storeOrderId": "", "credits": 0, "source": "", "grantedAt": "", "ref": "" }],
     "webhookEvents": [{ "eventId": "", "type": "", "receivedAt": "", "outcome": "" }]
   }
   entitlements is whatever you grant on payment (credits, licences, shipped goods), modelled as a credit count per order.
5. Do NOT expose a fulfil-without-capture route in production; if one exists for testing it must return 404.

Correctness to preserve (FaultLine checks these): grant credits/fulfilment EXACTLY ONCE, ONLY AFTER a verified capture, for the amount PayPal ACTUALLY captured — never from an unverified or duplicated webhook, and never for a client-chosen price.

When you're done, tell me the store's base URL, the probe token, and the framework you used, and give me the exact command to run:
npx faultline test --store <url> --probe-token <token> --paypal-port 4500 --proxy-port 4510`;

export default function AgentPromptPage() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="section">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <Link href="/integrate" className="link" style={{ fontSize: 14 }}>
          ← Integrate
        </Link>
        <div className="eyebrow" style={{ marginTop: 16 }}>Agent prompt</div>
        <h1 style={{ fontSize: 44 }}>Let your coding agent integrate FaultLine.</h1>
        <p style={{ marginTop: 16, fontSize: 18 }}>
          Copy the prompt below and paste it to your coding agent (Claude Code, Cursor, …) with your store&apos;s repository open. It implements the FaultLine
          contract in your stack, so you can run <span className="mono">npx faultline test</span> against it. <b>Sandbox only.</b>
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 28 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>The prompt</h2>
          <button type="button" className="btn ember" onClick={copy} aria-live="polite" style={{ fontSize: 14, padding: "9px 18px" }}>
            {copied ? "Copied ✓" : "Copy prompt"}
          </button>
        </div>
        <pre
          className="mono"
          style={{ background: "var(--graphite)", color: "#f4f1ea", padding: "18px 20px", borderRadius: "var(--radius-card)", overflowX: "auto", fontSize: 12.5, lineHeight: 1.65, margin: "14px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {PROMPT}
        </pre>

        <div className="card asym" style={{ marginTop: 32, background: "var(--ivory)" }}>
          <b style={{ fontFamily: "var(--font-display)" }}>Prefer a worked example?</b>{" "}
          <span style={{ fontSize: 15 }}>
            The bundled reference store, BuggyBeans, implements this exact contract — its order, webhook and probe routes are the canonical implementation. See the{" "}
            <Link href="/integrate" className="link">contract and setup steps</Link> for the full details.
          </span>
        </div>
      </div>
    </main>
  );
}

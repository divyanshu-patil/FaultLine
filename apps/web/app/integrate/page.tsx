import Link from "next/link";

export const metadata = { title: "Integrate your store — FaultLine" };

const PROBE_SHAPE = `GET /__crashtest/state      Authorization: Bearer <PROBE_TOKEN>

{
  "storeTime": "2026-10-19T12:00:00.000Z",
  "orders": [
    { "storeOrderId": "o_ab12", "paypalOrderId": "5LU...", "sku": "house-blend",
      "qty": 1, "status": "paid", "captureId": "3EM...", "amount": "12.00",
      "currency": "USD", "updatedAt": "..." }
  ],
  "entitlements": [
    { "storeOrderId": "o_ab12", "credits": 100, "source": "webhook",
      "grantedAt": "...", "ref": "3EM..." }
  ],
  "webhookEvents": [
    { "eventId": "WH-...", "type": "PAYMENT.CAPTURE.COMPLETED",
      "receivedAt": "...", "outcome": "processed" }
  ]
}`;

const SECURITY: [string, string][] = [
  ["Sandbox only", "FaultLine refuses any PayPal host but the sandbox, and the simulated backend never touches the network. Never point it at production."],
  ["The probe is read-only", "GET /__crashtest/state must never change state and must not return customer PII — model entitlements as counts and ids."],
  ["Protect the probe token", "Use a fresh random ≥16-char token and treat it as a secret; the probe gates on a constant-time compare."],
  ["You own the run", "Self-host so your store and its credentials stay with you. Deployed FaultLine keeps external targets disabled to avoid attacking a URL you don't own."],
];

const ENDPOINTS: [string, string, string][] = [
  ["POST /api/orders", "Create an order", "Body {sku, qty, amount?}. Price from your own catalog and ignore the optional client amount (that's attack A5). Respond {\"id\": \"<paypal order id>\"}."],
  ["POST /api/orders/{id}/capture", "Capture", "Capture against PayPal; respond {\"status\": \"COMPLETED\"} on success."],
  ["POST /api/orders/{id}/fulfil", "Fulfil (optional)", "Only a buggy store grants goods here without a capture (A6). A correct store returns 404."],
  ["POST /webhooks/paypal", "Webhook receiver", "Verify the signature via PAYPAL_API_BASE, then update state. FaultLine delivers here — sometimes duplicated, reordered or withheld."],
  ["GET /__crashtest/state", "State probe", "Bearer PROBE_TOKEN. A read-only snapshot: orders, entitlements (credits granted) and webhookEvents, so the checker can compare it to PayPal's record."],
];

const CONFIG: [string, string][] = [
  ["PAYPAL_API_BASE", "the simulated-PayPal URL FaultLine prints at startup (e.g. http://127.0.0.1:4500)"],
  ["PAYPAL_WEBHOOK_ID", "the webhook id FaultLine prints (default 8PT597110X687430LKGECATA)"],
  ["PROBE_TOKEN", "a random ≥16-char token — the same value you pass to FaultLine"],
];

const CLI = `npx faultline test \\
  --store https://your-store.example \\
  --probe-token "$PROBE_TOKEN" \\
  --paypal-port 4500 --proxy-port 4510 \\
  --attacks A1,A2,A5,A6,A7,A8        # --json, --fail-on-findings`;

function Code({ children }: { children: string }) {
  return (
    <pre
      className="mono"
      style={{ background: "var(--graphite)", color: "#f4f1ea", padding: "16px 18px", borderRadius: "var(--radius-card)", overflowX: "auto", fontSize: 13, lineHeight: 1.6, margin: "14px 0 0" }}
    >
      {children}
    </pre>
  );
}

export default function IntegratePage() {
  return (
    <main className="section">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="eyebrow">Integrate your store</div>
        <h1 style={{ fontSize: 44 }}>Crash-test your own checkout.</h1>
        <p style={{ marginTop: 16, fontSize: 18 }}>
          Point FaultLine at your own PayPal sandbox integration — not just the demo store. Your store implements a small contract; FaultLine drives a purchase,
          disturbs the webhooks, reads your state and grades it with the deterministic checks. <b>Sandbox only.</b> You run FaultLine next to your store, so nothing
          leaves your machine.
        </p>

        <h2 style={{ marginTop: 44 }}>1 — Implement the contract</h2>
        <p style={{ marginTop: 12 }}>Five endpoints (the default paths match the bundled reference store, BuggyBeans):</p>
        <div className="grid" style={{ gap: 12, marginTop: 16 }}>
          {ENDPOINTS.map(([ep, title, body]) => (
            <div className="card" key={ep}>
              <div className="mono ember" style={{ fontSize: 13 }}>{ep}</div>
              <h3 style={{ marginTop: 8, fontSize: 16 }}>{title}</h3>
              <p style={{ marginTop: 6, marginBottom: 0, fontSize: 14 }}>{body}</p>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 20, fontSize: 14 }} className="muted">
          The state probe is the one FaultLine can&apos;t work without — it&apos;s how the checker reads your truth. Return exactly this shape (<span className="mono">entitlements</span>{" "}
          is whatever you grant on payment, as a credit count per order):
        </p>
        <Code>{PROBE_SHAPE}</Code>

        <div className="card asym" style={{ marginTop: 24, background: "var(--ember-wash)", borderLeft: "3px solid var(--ember)" }}>
          <b style={{ fontFamily: "var(--font-display)" }}>Let your agent do step 1.</b>{" "}
          <span style={{ fontSize: 15 }}>
            Open the <Link className="link" href="/integrate/agent-prompt">agent prompt</Link>, copy it, and paste it to Claude Code or Cursor with your
            store&apos;s repo open — it implements the contract below in your stack.
          </span>
        </div>

        <h2 style={{ marginTop: 44 }}>2 — Configure your store</h2>
        <p style={{ marginTop: 12 }}>No real PayPal credentials are needed on the simulated backend. Set:</p>
        <ul style={{ marginTop: 14, display: "grid", gap: 10, listStyle: "none", padding: 0 }}>
          {CONFIG.map(([k, v]) => (
            <li key={k} style={{ display: "flex", gap: 10, fontSize: 14 }}>
              <span className="mono ember" style={{ flex: "none" }}>{k}</span>
              <span className="muted">— {v}</span>
            </li>
          ))}
        </ul>

        <h2 style={{ marginTop: 44 }}>3 — Run the crash test</h2>
        <p style={{ marginTop: 12 }}>With Node 20+, no checkout needed:</p>
        <Code>{CLI}</Code>
        <p style={{ marginTop: 14, fontSize: 14 }} className="muted">
          FaultLine prints the simulated-PayPal URL to point your store at, runs each attack, and prints a table of findings. Add <span className="mono">--json</span>{" "}
          for CI and <span className="mono">--fail-on-findings</span> to fail the build when a bug is found. A3 and A4 need the operator hooks; the rest run on the
          simulated backend.
        </p>

        <h2 style={{ marginTop: 44 }}>Safety</h2>
        <div className="grid two" style={{ marginTop: 20 }}>
          {SECURITY.map(([title, body]) => (
            <div className="card" key={title}>
              <h3 style={{ fontSize: 16 }}>{title}</h3>
              <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>{body}</p>
            </div>
          ))}
        </div>

        <div className="card asym" style={{ marginTop: 40, background: "var(--ivory)" }}>
          <b style={{ fontFamily: "var(--font-display)" }}>Self-host vs hosted.</b>{" "}
          <span style={{ fontSize: 15 }}>
            This is the self-host path — you own the run and your store never leaves your machine. In a deployed (hosted) FaultLine, attacking an arbitrary URL is
            disabled, so run FaultLine yourself to test your own store. Next step: open the <Link className="link" href="/integrate/agent-prompt">agent prompt</Link>.
          </span>
        </div>
      </div>
    </main>
  );
}

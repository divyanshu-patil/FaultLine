export const metadata = { title: "Integrate your store — FaultLine" };

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

        <div className="card asym" style={{ marginTop: 24, background: "var(--ember-wash)", borderLeft: "3px solid var(--ember)" }}>
          <b style={{ fontFamily: "var(--font-display)" }}>Let your agent do step 1.</b>{" "}
          <span style={{ fontSize: 15 }}>
            Paste the prompt in{" "}
            <a className="link" href="https://github.com/divyanshu-patil/FaultLine/blob/main/docs/22-agent-integration-prompt.md">docs/22</a>{" "}
            to Claude Code or Cursor with your store&apos;s repo open, and it implements the contract below in your stack.
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
        <p style={{ marginTop: 12 }}>Clone FaultLine, <span className="mono">pnpm install</span>, then from the repo root:</p>
        <Code>{CLI}</Code>
        <p style={{ marginTop: 14, fontSize: 14 }} className="muted">
          FaultLine prints the simulated-PayPal URL to point your store at, runs each attack, and prints a table of findings. Add <span className="mono">--json</span>{" "}
          for CI and <span className="mono">--fail-on-findings</span> to fail the build when a bug is found. A3 and A4 need the operator hooks; the rest run on the
          simulated backend.
        </p>

        <div className="card asym" style={{ marginTop: 40, background: "var(--ivory)" }}>
          <b style={{ fontFamily: "var(--font-display)" }}>Self-host vs hosted.</b>{" "}
          <span style={{ fontSize: 15 }}>
            This page documents the self-host path — you own the run and your store never leaves your machine. In a deployed (hosted) FaultLine, attacking an
            arbitrary URL is disabled; run FaultLine yourself to test your own store. The full contract, exact request/response shapes and security notes are in{" "}
            <a className="link" href="https://github.com/divyanshu-patil/FaultLine/blob/main/docs/21-integrate-your-store.md">docs/21 — Integrate your store</a>.
          </span>
        </div>
      </div>
    </main>
  );
}

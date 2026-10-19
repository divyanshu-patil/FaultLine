import Link from "next/link";
import { getJson } from "../lib/api";

const STEPS = [
  ["Recon", "The agent reads the store's payment code and lists suspects."],
  ["Attack", "A real sandbox buyer pays; webhooks are duplicated, delayed, forged or dropped."],
  ["Verdict", "Deterministic checks compare PayPal's record with the store's. Pass or fail."],
  ["Diagnose", "The agent explains each failure, citing evidence IDs from the trace."],
  ["Patch", "It writes a small fix, guarded and applied to a throwaway copy."],
  ["Prove", "The same attack runs again on the patched store. Red turns green — or it doesn't."],
];

export default async function Home() {
  const pinned = await getJson<{ slug: string | null }>("/api/reports/pinned", { authed: false });
  return (
    <main>
      <section className="section">
        <div className="wrap" style={{ display: "grid", gap: 48, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div style={{ maxWidth: 760 }}>
            <div className="eyebrow">PayPal sandbox · Gemma 4 on Ollama Cloud</div>
            <h1>
              An AI agent that shops at your store <span className="ember">to break it.</span>
            </h1>
            <p style={{ fontSize: 18, maxWidth: 620, marginTop: 20 }}>
              FaultLine places real PayPal sandbox orders, then recreates the conditions that break real integrations — duplicate and out-of-order webhooks, a
              forged event, a capture that times out after the money moved, a tampered price, a declined payment. Then it explains the cause and proves the fix.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
              <Link className="btn ember" href="/runs/new?target=buggybeans:demo&mode=agent" data-tour="run">
                Run the demo crash test →
              </Link>
              {pinned?.slug ? (
                <Link className="btn ghost" href={`/reports/${pinned.slug}`} data-tour="report">
                  See a finished report
                </Link>
              ) : null}
              <Link className="btn ghost" href="/attacks">
                Browse the attacks
              </Link>
            </div>
          </div>

          <ChildExplainer />
        </div>
      </section>

      <section className="band section" data-tour="loop">
        <div className="wrap">
          <div className="eyebrow">How it works</div>
          <h2>Six steps, one loop, repeated per bug.</h2>
          <div className="grid three" style={{ marginTop: 32 }}>
            {STEPS.map(([title, body], i) => (
              <div className="card data" key={title}>
                <div className="mono" style={{ color: "var(--brass)", fontSize: 13 }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 style={{ marginTop: 8 }}>{title}</h3>
                <p style={{ marginTop: 8, marginBottom: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" data-tour="judge">
        <div className="wrap grid two" style={{ alignItems: "start" }}>
          <div>
            <div className="eyebrow">What is real, what is simulated</div>
            <h2>The AI never decides truth.</h2>
            <p style={{ marginTop: 16 }}>
              Pass and fail come only from deterministic invariant checks over PayPal&apos;s own order and capture records and the store&apos;s state probe. The
              model may choose attacks, explain failures and write patches — it can never mark a check passed or cite an ID that is not in the trace.
            </p>
            <p>Every purchase, capture and webhook signature is real PayPal sandbox traffic. Forged events and injected faults are labelled as such, everywhere.</p>
          </div>
          <div className="card asym">
            <h3>Built on</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 10, fontSize: 14 }}>
              {[
                ["PayPal Orders v2", "real sandbox purchases, captures, GET-order truth reads"],
                ["PayPal webhooks", "real signed deliveries, verify-webhook-signature, negative testing, PayPal-Request-Id"],
                ["Gemma 4 31B", "recon, planning, diagnosis and patches on Ollama Cloud"],
                ["Deterministic core", "invariants I1–I7 as pure functions — the judge"],
              ].map(([k, v]) => (
                <li key={k} style={{ display: "flex", gap: 10 }}>
                  <span className="ember" aria-hidden>
                    ▸
                  </span>
                  <span>
                    <b style={{ fontFamily: "var(--font-display)" }}>{k}</b> — <span className="muted">{v}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

function ChildExplainer() {
  return (
    <div className="card ivory asym" style={{ maxWidth: 820 }}>
      <p style={{ margin: 0, color: "var(--steel)", fontSize: 15 }}>
        <b style={{ fontFamily: "var(--font-display)", color: "var(--graphite)" }}>In plain words.</b> A little shop gives a sticker when a friend pays.
        Sometimes the &ldquo;they paid!&rdquo; message arrives twice and the shop hands out two stickers. FaultLine is a friendly robot shopper that plays those tricky
        games — paying twice over, saying a toy costs a penny — to see if the shop gets confused, then shows exactly what went wrong and checks the fix. Only
        pretend money.
      </p>
    </div>
  );
}

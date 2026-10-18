export const metadata = { title: "About — FaultLine" };

const SAFETY = [
  ["Sandbox only", "The only PayPal host FaultLine can reach is the sandbox. A boot-time allowlist and a CI check enforce it; no production credentials are accepted."],
  ["Owned targets only", "Hosted mode attacks only the bundled BuggyBeans store. Self-hosted mode needs an ownership token and refuses private network ranges."],
  ["The AI never judges", "Pass and fail are pure functions over PayPal's records and the store's state probe. The model cannot mark a check passed or cite an ID that is not in the trace."],
  ["Patches run in throwaway copies", "An AI-written fix is checked by a guard (allowlisted files, no shell, no new hosts) and only ever runs in a fresh BuggyBeans instance with no long-lived secrets."],
];

export default function AboutPage() {
  return (
    <main className="section">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div className="eyebrow">About</div>
        <h1 style={{ fontSize: 48 }}>A crash test for PayPal checkout.</h1>
        <p style={{ marginTop: 16, fontSize: 18 }}>
          Most integrations are only tested on the happy path: one sandbox purchase that succeeds. But PayPal webhooks can arrive twice or out of order, and
          capture calls can time out after the money moved. FaultLine tests those unhappy paths with real sandbox traffic, and never lets the AI grade its own
          work.
        </p>

        <h2 style={{ marginTop: 48 }}>The safety model</h2>
        <div className="grid two" style={{ marginTop: 20 }}>
          {SAFETY.map(([title, body]) => (
            <div className="card" key={title}>
              <h3>{title}</h3>
              <p style={{ marginTop: 8, marginBottom: 0 }}>{body}</p>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 48 }}>Limitations</h2>
        <p style={{ marginTop: 14 }}>
          FaultLine is sandbox only; it never touches production. It does not attack stores you do not own, apply patches to your real repository, or test
          authorize/void, refunds or subscriptions. It is not a general web security scanner.
        </p>
      </div>
    </main>
  );
}

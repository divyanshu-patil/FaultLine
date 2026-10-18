import Link from "next/link";

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <span>
          <b style={{ fontFamily: "var(--font-display)" }}>FaultLine</b> · PayPal sandbox only. Verdicts come from deterministic checks against PayPal&apos;s own record, not the AI.
        </span>
        <span className="muted">
          <Link className="link" href="/about">
            How it works
          </Link>{" "}
          · MIT licensed · Built for the PayPal AI Hackathon
        </span>
      </div>
    </footer>
  );
}

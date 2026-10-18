"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/runs/new";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json", "x-fl-csrf": "1" }, body: JSON.stringify({ code }) });
    setBusy(false);
    if (res.status === 204) {
      router.push(next);
      router.refresh();
      return;
    }
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      setError(`Too many attempts. Try again in ${retry ?? "a few"} seconds.`);
      return;
    }
    setError("That access code was not recognised.");
  }

  return (
    <main className="section">
      <div className="wrap" style={{ maxWidth: 440 }}>
        <div className="eyebrow">Access</div>
        <h1 style={{ fontSize: 40 }}>Sign in</h1>
        <p style={{ marginTop: 12 }}>FaultLine runs real sandbox purchases and AI calls, so the demo is behind an access code. Judges&apos; code is in the submission instructions.</p>
        <form onSubmit={submit} className="card asym" style={{ marginTop: 20 }}>
          <label className="field">
            Access code
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" aria-invalid={!!error} />
          </label>
          {error ? (
            <p role="alert" style={{ color: "var(--ember)", fontSize: 14, margin: "0 0 14px" }}>
              {error}
            </p>
          ) : null}
          <button className="btn ember" disabled={busy || !code}>
            {busy ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="section"><div className="wrap"><p className="muted">Loading…</p></div></main>}>
      <LoginForm />
    </Suspense>
  );
}

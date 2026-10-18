"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Target = { id: string; slug: string; name: string; description: string };

const PRESET_ORDER = ["buggybeans:demo", "buggybeans:all", "buggybeans:fixed"];

export default function NewRunPage() {
  const router = useRouter();
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [slug, setSlug] = useState("buggybeans:demo");
  const [mode, setMode] = useState<"agent" | "checklist">("agent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/targets")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((t: Target[]) => {
        setTargets(t);
        setAuthed(true);
      })
      .catch(() => setAuthed(false));
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json", "x-fl-csrf": "1" }, body: JSON.stringify({ targetId: slug, mode }) });
    setBusy(false);
    if (res.status === 202) {
      const { runId } = await res.json();
      router.push(`/runs/${runId}`);
      return;
    }
    const body = await res.json().catch(() => null);
    if (res.status === 409) setError("You already have a run in progress. Open it or cancel it first.");
    else setError(body?.error?.message ?? "Could not start the run.");
  }

  if (authed === false) {
    return (
      <main className="section">
        <div className="wrap" style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 40 }}>Sign in to run</h1>
          <p style={{ marginTop: 12 }}>A crash test spends real sandbox and AI budget, so it needs an access code.</p>
          <Link className="btn ember" href="/login?next=/runs/new">
            Enter an access code →
          </Link>
        </div>
      </main>
    );
  }

  const ordered = (targets ?? []).slice().sort((a, b) => PRESET_ORDER.indexOf(a.slug) - PRESET_ORDER.indexOf(b.slug));

  return (
    <main className="section">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div className="eyebrow">New crash test</div>
        <h1 style={{ fontSize: 44 }}>Pick a target and a mode.</h1>

        <h3 style={{ marginTop: 36 }}>Target</h3>
        <div className="grid" style={{ marginTop: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {targets === null
            ? [0, 1, 2].map((i) => <div className="card" key={i} style={{ height: 120, opacity: 0.4 }} />)
            : ordered.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => setSlug(t.slug)}
                  className="card"
                  style={{ textAlign: "left", cursor: "pointer", border: slug === t.slug ? "2px solid var(--ember)" : "2px solid transparent", background: slug === t.slug ? "var(--canvas)" : "var(--ash)" }}
                  aria-pressed={slug === t.slug}
                >
                  <h3 style={{ fontSize: 18 }}>{t.name}</h3>
                  <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>{t.description}</p>
                </button>
              ))}
        </div>

        <h3 style={{ marginTop: 36 }}>Mode</h3>
        <div className="grid two" style={{ marginTop: 14 }}>
          <ModeCard value="agent" current={mode} onSelect={setMode} title="Agent" body="Gemma 4 reads the code, picks attacks, explains failures and writes patches." />
          <ModeCard value="checklist" current={mode} onSelect={setMode} title="Checklist" body="No AI. Runs every selected attack in order — the baseline and fallback." />
        </div>

        {error ? (
          <p role="alert" style={{ color: "var(--ember)", marginTop: 20 }}>
            {error}
          </p>
        ) : null}
        <div style={{ marginTop: 28 }}>
          <button className="btn ember" onClick={start} disabled={busy}>
            {busy ? "Starting…" : "Start crash test →"}
          </button>
        </div>
      </div>
    </main>
  );
}

function ModeCard({ value, current, onSelect, title, body }: { value: "agent" | "checklist"; current: string; onSelect: (v: "agent" | "checklist") => void; title: string; body: string }) {
  const active = current === value;
  return (
    <button type="button" onClick={() => onSelect(value)} className="card" style={{ textAlign: "left", cursor: "pointer", border: active ? "2px solid var(--ember)" : "2px solid transparent", background: active ? "var(--canvas)" : "var(--ash)" }} aria-pressed={active}>
      <h3 style={{ fontSize: 18 }}>{title}</h3>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>{body}</p>
    </button>
  );
}

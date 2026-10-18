import { cookies, headers } from "next/headers";

/** Server-side base URL for the API (same origin as the browser, resolved for server fetches). */
async function origin(): Promise<string> {
  if (process.env.API_ORIGIN) return process.env.API_ORIGIN;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function apiFetch(path: string, opts: { authed?: boolean; cache?: RequestCache } = {}): Promise<Response> {
  const url = `${await origin()}${path.startsWith("/api") ? path : `/api${path}`}`;
  const headerBag: Record<string, string> = {};
  if (opts.authed !== false) {
    const jar = await cookies();
    const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
    if (cookie) headerBag.cookie = cookie;
  }
  return fetch(url, { headers: headerBag, cache: opts.cache ?? "no-store" });
}

export async function getJson<T>(path: string, opts?: { authed?: boolean }): Promise<T | null> {
  const res = await apiFetch(path, opts);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// ---------- types (mirror the API responses) ----------

export type Attack = {
  id: string;
  name: string;
  priority: "must" | "should" | "could";
  bugClass: string;
  invariants: string[];
  invariantText: string[];
  realVsSimulated: string;
  description: string;
};
export type Target = { id: string; slug: string; kind: string; name: string; description: string; status: string; bugs?: string[] };
export type Verdict = { invariant: string; status: "pass" | "fail" | "not_applicable"; expected: string; actual: string; evidence: string[] };
export type RunSummary = { id: string; mode: string; effectiveMode: string; status: string; phase: string; summary: { headline?: string } | null; createdAt: string; target: { name: string; slug: string } };
export type Finding = { id: string; attackRowId: string; attackId: string; failedInvariants: string[]; verdicts: Verdict[]; evidence: string[]; severity: string };
export type RunDetail = {
  id: string;
  status: string;
  phase: string;
  mode: string;
  effectiveMode: string;
  model: string | null;
  usage: Record<string, number>;
  target: { name: string; slug: string; kind: string };
  createdAt: string;
  attacks: { id: string; attackId: string; purpose: string; status: string; verdicts: Verdict[] | null }[];
  findings: Finding[];
  reportSlug: string | null;
  summary: { headline?: string; counts?: Record<string, number> } | null;
};
export type Diagnosis = { source: "model" | "template"; body: { category: string; root_cause: string; mechanism_steps: string[]; evidence: string[]; affected_files: string[]; confidence: number; unknowns: string[] }; evidenceValid: boolean };
export type Patch = { attempt: number; source: "model" | "reference"; diff: string; guard: { passed: boolean; reasons: string[] }; build: { passed: boolean } | null; status: string; verdicts: Verdict[] | null };
export type FindingDetail = Finding & { runId: string; diagnosis: Diagnosis | null; patches: Patch[] };
export type Report = {
  slug: string;
  target: { name: string; slug: string };
  mode: string;
  effectiveMode: string;
  model: string | null;
  createdAt: string;
  usage: Record<string, number>;
  summary: { headline: string; counts: Record<string, number> };
  findings: ReportFinding[];
  realVsSimulated: { attackId: string; text: string }[];
};
export type ReportFinding = {
  id: string;
  attackId: string;
  title: string;
  severity: string;
  failedInvariants: string[];
  verdicts: Verdict[];
  diagnosis: Diagnosis | null;
  patch: (Patch & { label: string }) | null;
};

export const PHASES = ["queued", "preparing", "recon", "attacking", "diagnosing", "patching", "verifying", "reporting", "done"] as const;

import { createHash } from "node:crypto";
import { EVIDENCE_ID_RE, type EvidencePrefix } from "@faultline/schemas";

export type TraceKind =
  | "paypal_call"
  | "webhook_delivery"
  | "webhook_forward"
  | "browser_step"
  | "state_snapshot"
  | "truth_read"
  | "invariant_result"
  | "source_excerpt";

export const PREFIX: Record<TraceKind, EvidencePrefix> = {
  paypal_call: "pc",
  webhook_delivery: "wh",
  webhook_forward: "wf",
  browser_step: "br",
  state_snapshot: "st",
  truth_read: "tr",
  invariant_result: "iv",
  source_excerpt: "src",
};

/** Timeline swimlane for each kind (docs/11 S4). */
export const LANE: Record<TraceKind, "browser" | "store" | "proxy" | "paypal" | "checker"> = {
  browser_step: "browser",
  state_snapshot: "store",
  source_excerpt: "store",
  webhook_forward: "proxy",
  webhook_delivery: "paypal",
  paypal_call: "paypal",
  truth_read: "paypal",
  invariant_result: "checker",
};

export type TraceItem = {
  runId: string;
  evidenceId: string;
  attackRowId: string | null;
  kind: TraceKind;
  at: string;
  summary: Record<string, unknown>;
  detail: unknown;
};

// ---------- redaction (docs/12 §4, AC-29) ----------

const SECRET_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "client_secret",
  "access_token",
  "refresh_token",
  "id_token",
  "password",
  "cookie",
  "set-cookie",
  "x-api-key",
]);
const HASHED_KEYS = new Set(["paypal-transmission-sig", "transmission_sig"]);
const CREDENTIAL_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const QUERY_SECRET_RE = /([?&](?:access_token|client_secret|password)=)[^&\s]+/gi;

export function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/** Deep copy with secrets removed. `secrets` are literal values (env secrets) to scrub wherever they appear. */
export function redact<T>(value: T, secrets: readonly string[] = []): T {
  const live = secrets.filter((s) => s && s.length >= 8);
  const scrub = (s: string): string => {
    let out = s.replace(CREDENTIAL_RE, "$1 [redacted]").replace(QUERY_SECRET_RE, "$1[redacted]");
    for (const secret of live) out = out.split(secret).join("[redacted]");
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) {
        const key = k.toLowerCase();
        if (SECRET_KEYS.has(key)) out[k] = "[redacted]";
        else if (HASHED_KEYS.has(key) && typeof inner === "string") out[k] = hashValue(inner);
        else out[k] = walk(inner);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

// ---------- evidence ids (docs/04 F8, AC-30/31) ----------

export type Recorder = {
  record(runId: string, attackRowId: string | null, kind: TraceKind, summary: Record<string, unknown>, detail?: unknown): string;
  known(runId: string): Set<string>;
  flush(): Promise<void>;
  forget(runId: string): void;
};

/** Assigns evidence ids synchronously (unique per run and prefix) and persists through `sink` with secrets redacted. */
export function createRecorder(sink: (item: TraceItem) => Promise<void> | void, secrets: readonly string[] = []): Recorder {
  const counters = new Map<string, number>();
  const ids = new Map<string, Set<string>>();
  const pending = new Set<Promise<void>>();
  return {
    record(runId, attackRowId, kind, summary, detail) {
      const prefix = PREFIX[kind];
      const key = `${runId}:${prefix}`;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      const evidenceId = `${prefix}-${String(n).padStart(4, "0")}`;
      if (!ids.has(runId)) ids.set(runId, new Set());
      ids.get(runId)!.add(evidenceId);
      const item: TraceItem = {
        runId,
        evidenceId,
        attackRowId,
        kind,
        at: new Date().toISOString(),
        summary: redact(summary, secrets),
        detail: detail === undefined ? null : redact(detail, secrets),
      };
      const p = Promise.resolve()
        .then(() => sink(item))
        .catch(() => undefined)
        .finally(() => pending.delete(p));
      pending.add(p);
      return evidenceId;
    },
    known: (runId) => new Set(ids.get(runId) ?? []),
    flush: async () => {
      await Promise.all([...pending]);
    },
    forget(runId) {
      ids.delete(runId);
      for (const key of [...counters.keys()]) if (key.startsWith(`${runId}:`)) counters.delete(key);
    },
  };
}

/** Every evidence-looking id mentioned anywhere in a model output. */
export function findEvidenceRefs(output: unknown): string[] {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return [...new Set(text.match(EVIDENCE_ID_RE) ?? [])];
}

/** AC-31: an output citing an id that is not in the run's trace is rejected. */
export function validateEvidenceRefs(output: unknown, known: ReadonlySet<string>): { ok: boolean; unknown: string[] } {
  const unknown = findEvidenceRefs(output).filter((id) => !known.has(id));
  return { ok: unknown.length === 0, unknown };
}

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The subset of `pg.Pool` / PGlite that FaultLine uses. Both satisfy it. */
export type Sql = { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> };

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function migrate(sql: Sql): Promise<string[]> {
  await sql.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await sql.query("select name from schema_migrations")).rows.map((r) => r.name as string));
  const applied: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const text = readFileSync(MIGRATIONS + file, "utf8");
    // one statement at a time: works on pg and PGlite alike
    for (const stmt of text.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) await sql.query(stmt);
    await sql.query("insert into schema_migrations (name) values ($1)", [file]);
    applied.push(file);
  }
  return applied;
}

export async function createPool(url: string): Promise<Sql & { end(): Promise<void> }> {
  const { default: pg } = await import("pg");
  if (/:6543\//.test(url)) throw new Error("DATABASE_URL uses the transaction pooler (6543); use the session pooler (5432) or a direct URL");
  const pool = new pg.Pool({ connectionString: url, max: 5, ssl: /sslmode=require|supabase\.co|pooler\.supabase/.test(url) ? { rejectUnauthorized: false } : undefined });
  return pool;
}

const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

export type TargetRow = { id: string; slug: string; kind: string; name: string; description: string; bugs: string[]; status: string; createdBySession: string | null };
export type RunRow = {
  id: string;
  targetId: string;
  sessionId: string | null;
  mode: "agent" | "checklist";
  effectiveMode: "agent" | "checklist";
  status: string;
  phase: string;
  budget: Record<string, number>;
  usage: Record<string, number>;
  allowedAttacks: string[];
  model: string | null;
  promptVersion: string | null;
  summary: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  cancelRequested: boolean;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};
export type EventRow = { id: number; runId: string; kind: string; payload: Record<string, unknown>; createdAt: Date };
export type AttackRow = {
  id: string;
  runId: string;
  attackId: string;
  purpose: "baseline" | "verify" | "reference";
  instanceId: string | null;
  patchId: string | null;
  status: string;
  spec: Record<string, unknown>;
  verdicts: unknown[] | null;
  notes: Record<string, unknown> | null;
  startedAt: Date;
  finishedAt: Date | null;
};
export type TraceRow = { runId: string; evidenceId: string; attackRowId: string | null; kind: string; at: Date; summary: Record<string, unknown>; detail: unknown };
export type FindingRow = {
  id: string;
  runId: string;
  attackRowId: string;
  attackId: string;
  failedInvariants: string[];
  verdicts: unknown[];
  evidence: string[];
  severity: string;
  createdAt: Date;
};
export type DiagnosisRow = { id: string; findingId: string; source: "model" | "template"; body: Record<string, unknown>; evidenceValid: boolean; rawEvidenceValid: boolean | null; createdAt: Date };
export type PatchRow = {
  id: string;
  findingId: string;
  attempt: number;
  source: "model" | "reference";
  diff: string;
  guard: { passed: boolean; reasons: string[] };
  build: { passed: boolean; output?: string } | null;
  status: string;
  verifyAttackRowId: string | null;
  verdicts: unknown[] | null;
  createdAt: Date;
};
export type ReportRow = { id: string; runId: string; slug: string; body: Record<string, unknown>; pinned: boolean; createdAt: Date };
export type JobRow = { id: number; kind: string; payload: Record<string, unknown>; status: string; attempts: number };

const RUN_COLS = `id, target_id as "targetId", session_id as "sessionId", mode, effective_mode as "effectiveMode", status, phase, budget, usage,
  allowed_attacks as "allowedAttacks", model, prompt_version as "promptVersion", summary, error, cancel_requested as "cancelRequested",
  created_at as "createdAt", started_at as "startedAt", finished_at as "finishedAt"`;
const TARGET_COLS = `id, slug, kind, name, description, bugs, status, created_by_session as "createdBySession"`;
const ATTACK_COLS = `id, run_id as "runId", attack_id as "attackId", purpose, instance_id as "instanceId", patch_id as "patchId", status, spec, verdicts, notes,
  started_at as "startedAt", finished_at as "finishedAt"`;
const FINDING_COLS = `id, run_id as "runId", attack_row_id as "attackRowId", attack_id as "attackId", failed_invariants as "failedInvariants", verdicts, evidence, severity, created_at as "createdAt"`;
const PATCH_COLS = `id, finding_id as "findingId", attempt, source, diff, guard, build, status, verify_attack_row_id as "verifyAttackRowId", verdicts, created_at as "createdAt"`;

export function createDb(sql: Sql) {
  const one = async <T>(text: string, params: unknown[] = []): Promise<T | null> => ((await sql.query(text, params)).rows[0] as T) ?? null;
  const all = async <T>(text: string, params: unknown[] = []): Promise<T[]> => (await sql.query(text, params)).rows as T[];

  return {
    sql,
    ping: () => one<{ ok: number }>("select 1 as ok"),

    // sessions
    createSession: (codeHash: string, isOperator: boolean, ttlHours: number) =>
      one<{ id: string; expiresAt: Date }>(
        `insert into sessions (code_hash, is_operator, expires_at) values ($1, $2, now() + make_interval(hours => $3)) returning id, expires_at as "expiresAt"`,
        [codeHash, isOperator, ttlHours],
      ),
    getSession: (id: string) =>
      one<{ id: string; isOperator: boolean; expiresAt: Date }>(
        `select id, is_operator as "isOperator", expires_at as "expiresAt" from sessions where id = $1 and expires_at > now()`,
        [id],
      ),
    deleteSession: (id: string) => sql.query("delete from sessions where id = $1", [id]),

    // targets
    upsertTarget: (t: { slug: string; kind: string; name: string; description: string; bugs: string[]; createdBySession?: string | null }) =>
      one<TargetRow>(
        `insert into targets (slug, kind, name, description, bugs, created_by_session) values ($1, $2, $3, $4, $5, $6)
         on conflict (slug) do update set name = excluded.name, description = excluded.description, bugs = excluded.bugs
         returning ${TARGET_COLS}`,
        [t.slug, t.kind, t.name, t.description, t.bugs, t.createdBySession ?? null],
      ),
    listTargets: (sessionId: string | null) =>
      all<TargetRow>(`select ${TARGET_COLS} from targets where created_by_session is null or created_by_session = $1 order by created_at`, [sessionId]),
    getTarget: (idOrSlug: string) =>
      one<TargetRow>(`select ${TARGET_COLS} from targets where slug = $1 or id::text = $1`, [idOrSlug]),

    // runs + jobs
    createRun: (r: { targetId: string; sessionId: string | null; mode: string; budget: unknown; allowedAttacks: string[]; model: string | null }) =>
      one<{ id: string }>(
        `with r as (
           insert into runs (target_id, session_id, mode, effective_mode, status, phase, budget, allowed_attacks, model)
           values ($1, $2, $3, $3, 'queued', 'queued', $4::jsonb, $5, $6) returning id
         ), j as (insert into jobs (kind, payload) select 'run', jsonb_build_object('runId', r.id) from r)
         select id from r`,
        [r.targetId, r.sessionId, r.mode, j(r.budget), r.allowedAttacks, r.model],
      ),
    getRun: (id: string) => one<RunRow>(`select ${RUN_COLS} from runs where id::text = $1`, [id]),
    listRuns: (sessionId: string | null, limit: number) =>
      all<RunRow & { targetName: string; targetSlug: string }>(
        `select ${RUN_COLS.replace(/(^|,\s*)(\w+)/g, "$1runs.$2")}, t.name as "targetName", t.slug as "targetSlug"
         from runs join targets t on t.id = runs.target_id
         where ($1::uuid is null or runs.session_id = $1) order by runs.created_at desc limit $2`,
        [sessionId, limit],
      ),
    activeRun: (sessionId: string) =>
      one<{ id: string }>(`select id from runs where session_id = $1 and status in ('queued', 'running') order by created_at desc limit 1`, [sessionId]),
    updateRun: (id: string, patch: Partial<Pick<RunRow, "status" | "phase" | "effectiveMode" | "usage" | "summary" | "error" | "promptVersion">> & { started?: boolean; finished?: boolean }) =>
      sql.query(
        `update runs set
           status = coalesce($2, status), phase = coalesce($3, phase), effective_mode = coalesce($4, effective_mode),
           usage = coalesce($5::jsonb, usage), summary = coalesce($6::jsonb, summary), error = coalesce($7::jsonb, error),
           prompt_version = coalesce($8, prompt_version),
           started_at = case when $9 then coalesce(started_at, now()) else started_at end,
           finished_at = case when $10 then now() else finished_at end
         where id = $1`,
        [id, patch.status ?? null, patch.phase ?? null, patch.effectiveMode ?? null, j(patch.usage), j(patch.summary), j(patch.error), patch.promptVersion ?? null, !!patch.started, !!patch.finished],
      ),
    requestCancel: (id: string) =>
      one<{ status: string }>(
        `update runs set cancel_requested = true,
           status = case when status = 'queued' then 'cancelled' else status end,
           phase = case when status = 'queued' then 'done' else phase end,
           finished_at = case when status = 'queued' then now() else finished_at end
         where id = $1 returning status`,
        [id],
      ),
    isCancelRequested: async (id: string) => (await one<{ c: boolean }>("select cancel_requested as c from runs where id = $1", [id]))?.c ?? false,

    claimJob: (workerId: string, leaseSeconds: number) =>
      one<JobRow>(
        `update jobs set status = 'running', locked_by = $1, lease_until = now() + make_interval(secs => $2), attempts = attempts + 1, updated_at = now()
         where id = (select id from jobs where status = 'queued' or (status = 'running' and lease_until < now())
                     order by id for update skip locked limit 1)
         returning id, kind, payload, status, attempts`,
        [workerId, leaseSeconds],
      ),
    renewJob: (id: number, leaseSeconds: number) =>
      sql.query("update jobs set lease_until = now() + make_interval(secs => $2), updated_at = now() where id = $1", [id, leaseSeconds]),
    finishJob: (id: number, status: "done" | "failed") => sql.query("update jobs set status = $2, updated_at = now() where id = $1", [id, status]),

    // events
    addEvent: async (runId: string, kind: string, payload: Record<string, unknown>) =>
      (await one<{ id: number }>("insert into run_events (run_id, kind, payload) values ($1, $2, $3::jsonb) returning id", [runId, kind, j(payload)]))!.id,
    listEvents: (runId: string, afterId: number, limit = 1000) =>
      all<EventRow>(
        `select id, run_id as "runId", kind, payload, created_at as "createdAt" from run_events where run_id = $1 and id > $2 order by id limit $3`,
        [runId, afterId, limit],
      ),

    // agent steps and model calls
    addAgentStep: (s: { runId: string; stepNo: number; tool: string; args: unknown; why: string | null; valid: boolean; validationErrors: unknown; resultSummary: unknown }) =>
      sql.query(
        `insert into agent_steps (run_id, step_no, tool, args, why, valid, validation_errors, result_summary) values ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb)`,
        [s.runId, s.stepNo, s.tool, j(s.args), s.why, s.valid, j(s.validationErrors), j(s.resultSummary)],
      ),
    addModelCall: (m: { runId: string | null; purpose: string; provider: string; model: string; promptVersion: string; promptHash: string; inputTokens: number; outputTokens: number; estimated: boolean; latencyMs: number; outcome: string }) =>
      sql.query(
        `insert into model_calls (run_id, purpose, provider, model, prompt_version, prompt_hash, input_tokens, output_tokens, estimated, latency_ms, outcome)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [m.runId, m.purpose, m.provider, m.model, m.promptVersion, m.promptHash, Math.round(m.inputTokens), Math.round(m.outputTokens), m.estimated, Math.round(m.latencyMs), m.outcome],
      ),
    modelCallStats: (runId: string) =>
      one<{ calls: number; tokens: number }>(
        `select count(*)::int as calls, coalesce(sum(input_tokens + output_tokens), 0)::int as tokens from model_calls where run_id = $1`,
        [runId],
      ),

    // attacks
    createAttackRow: (a: { runId: string; attackId: string; purpose: string; patchId?: string | null; spec: unknown }) =>
      one<{ id: string }>(
        `insert into attacks (run_id, attack_id, purpose, patch_id, status, spec) values ($1, $2, $3, $4, 'running', $5::jsonb) returning id`,
        [a.runId, a.attackId, a.purpose, a.patchId ?? null, j(a.spec)],
      ).then((r) => r!.id),
    finishAttackRow: (id: string, f: { status: string; instanceId: string | null; verdicts: unknown; notes: unknown }) =>
      sql.query(`update attacks set status = $2, instance_id = $3, verdicts = $4::jsonb, notes = $5::jsonb, finished_at = now() where id = $1`, [
        id,
        f.status,
        f.instanceId,
        j(f.verdicts),
        j(f.notes),
      ]),
    listAttackRows: (runId: string) => all<AttackRow>(`select ${ATTACK_COLS} from attacks where run_id = $1 order by started_at`, [runId]),
    getAttackRow: (id: string) => one<AttackRow>(`select ${ATTACK_COLS} from attacks where id = $1`, [id]),

    // trace
    addTrace: (t: { runId: string; evidenceId: string; attackRowId: string | null; kind: string; at: string; summary: unknown; detail: unknown }) =>
      sql.query(
        `insert into trace_items (run_id, evidence_id, attack_row_id, kind, at, summary, detail) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         on conflict do nothing`,
        [t.runId, t.evidenceId, t.attackRowId, t.kind, t.at, j(t.summary), j(t.detail)],
      ),
    listTrace: (runId: string, attackRowId?: string) =>
      all<TraceRow>(
        `select run_id as "runId", evidence_id as "evidenceId", attack_row_id as "attackRowId", kind, at, summary, null as detail
         from trace_items where run_id = $1 and ($2::uuid is null or attack_row_id = $2) order by at, evidence_id`,
        [runId, attackRowId ?? null],
      ),
    getTrace: (runId: string, evidenceId: string) =>
      one<TraceRow>(
        `select run_id as "runId", evidence_id as "evidenceId", attack_row_id as "attackRowId", kind, at, summary, detail
         from trace_items where run_id = $1 and evidence_id = $2`,
        [runId, evidenceId],
      ),
    traceIds: async (runId: string) => new Set((await all<{ e: string }>("select evidence_id as e from trace_items where run_id = $1", [runId])).map((r) => r.e)),

    addDelivery: (d: { eventId: string | null; eventType: string | null; orderId: string | null; runId: string | null; instanceId: string | null; raw: Buffer; headers: unknown; forged: boolean; evidenceId: string | null }) =>
      sql.query(
        `insert into webhook_deliveries (paypal_event_id, event_type, order_id, run_id, instance_id, raw_body, headers, forged, evidence_id)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [d.eventId, d.eventType, d.orderId, d.runId, d.instanceId, d.raw, j(d.headers), d.forged, d.evidenceId],
      ),

    // findings, diagnoses, patches
    createFinding: (f: { runId: string; attackRowId: string; attackId: string; failedInvariants: string[]; verdicts: unknown; evidence: string[]; severity: string }) =>
      one<FindingRow>(
        `insert into findings (run_id, attack_row_id, attack_id, failed_invariants, verdicts, evidence, severity) values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning ${FINDING_COLS}`,
        [f.runId, f.attackRowId, f.attackId, f.failedInvariants, j(f.verdicts), f.evidence, f.severity],
      ).then((r) => r!),
    listFindings: (runId: string) => all<FindingRow>(`select ${FINDING_COLS} from findings where run_id = $1 order by created_at`, [runId]),
    getFinding: (id: string) => one<FindingRow>(`select ${FINDING_COLS} from findings where id::text = $1`, [id]),
    addDiagnosis: (d: { findingId: string; source: string; body: unknown; evidenceValid: boolean; rawEvidenceValid: boolean | null }) =>
      sql.query(`insert into diagnoses (finding_id, source, body, evidence_valid, raw_evidence_valid) values ($1, $2, $3::jsonb, $4, $5)`, [
        d.findingId,
        d.source,
        j(d.body),
        d.evidenceValid,
        d.rawEvidenceValid,
      ]),
    latestDiagnosis: (findingId: string) =>
      one<DiagnosisRow>(
        `select id, finding_id as "findingId", source, body, evidence_valid as "evidenceValid", raw_evidence_valid as "rawEvidenceValid", created_at as "createdAt"
         from diagnoses where finding_id = $1 order by created_at desc limit 1`,
        [findingId],
      ),
    addPatch: (p: { findingId: string; attempt: number; source: string; diff: string; guard: unknown; build?: unknown; status: string; verifyAttackRowId?: string | null; verdicts?: unknown }) =>
      one<{ id: string }>(
        `insert into patches (finding_id, attempt, source, diff, guard, build, status, verify_attack_row_id, verdicts)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb) returning id`,
        [p.findingId, p.attempt, p.source, p.diff, j(p.guard), j(p.build), p.status, p.verifyAttackRowId ?? null, j(p.verdicts)],
      ).then((r) => r!.id),
    updatePatch: (id: string, p: { status: string; build?: unknown; verifyAttackRowId?: string | null; verdicts?: unknown }) =>
      sql.query(
        `update patches set status = $2, build = coalesce($3::jsonb, build), verify_attack_row_id = coalesce($4, verify_attack_row_id), verdicts = coalesce($5::jsonb, verdicts) where id = $1`,
        [id, p.status, j(p.build), p.verifyAttackRowId ?? null, j(p.verdicts)],
      ),
    listPatches: (findingId: string) => all<PatchRow>(`select ${PATCH_COLS} from patches where finding_id = $1 order by created_at`, [findingId]),

    // reports
    createReport: (runId: string, slug: string, body: unknown) =>
      sql.query(`insert into reports (run_id, slug, body) values ($1, $2, $3::jsonb) on conflict (run_id) do update set body = excluded.body`, [runId, slug, j(body)]),
    getReportBySlug: (slug: string) =>
      one<ReportRow>(`select id, run_id as "runId", slug, body, pinned, created_at as "createdAt" from reports where slug = $1`, [slug]),
    getReportForRun: (runId: string) => one<{ slug: string }>(`select slug from reports where run_id = $1`, [runId]),
    pinnedReport: () => one<{ slug: string }>(`select slug from reports where pinned order by created_at desc limit 1`),
    pinReport: (runId: string) => sql.query(`update reports set pinned = (run_id = $1)`, [runId]),
  };
}

export type Db = ReturnType<typeof createDb>;

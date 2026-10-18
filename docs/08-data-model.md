# 08. Data model (Supabase Postgres)

CCT's data lives in one Supabase Postgres database, accessed **only from the server** (`apps/api`, `apps/proxy`, `apps/worker`) with Drizzle over `pg`. BuggyBeans instances use their own SQLite files (ADR-006) and are not part of this schema.

## 1. Supabase notes

- Connection: **session pooler (port 5432) or direct connection**. Never the transaction pooler (6543): it breaks `SKIP LOCKED` leases held across statements, `LISTEN/NOTIFY` and prepared statements ✅ (2026-10-17).
- Row Level Security: **enabled on every table with no policies**, so the anon/public keys can read nothing; the server connects as the `postgres` role (or a dedicated role) ⚠️ (Supabase default behaviour; confirm in S8).
- Free plan: 500 MB DB, project pauses after 7 days without activity ✅ (2026-10-17). A cron ping (`GET /api/health?db=1` every 6 h) keeps it awake during judging.
- Migrations: Drizzle → SQL files in `infra/supabase/migrations`, applied with `pnpm db:migrate`.

## 2. Tables

Types: `id` columns are `uuid` (default `gen_random_uuid()`) unless noted; timestamps are `timestamptz`.

### sessions
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| code_hash | text | sha256 of the access code used |
| created_at, expires_at | timestamptz | |
| ip_hash | text | for rate limits |

### targets
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| slug | text unique | `buggybeans:demo`, … |
| kind | text | `buggybeans` \| `external` |
| name | text | |
| bugs | text[] | BuggyBeans only; never sent to the model |
| status | text | `ready` \| `pending_verification` \| `verified` \| `disabled` |
| contract | jsonb | external: base URL, webhook path, probe path, source location |
| verify_token_hash | text | external only |
| created_by_session | uuid fk sessions | |
| created_at | timestamptz | |

### runs
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| target_id | uuid fk | |
| session_id | uuid fk | |
| mode | text | `agent` \| `checklist` |
| effective_mode | text | becomes `checklist` if degraded |
| status | text | state machine in `docs/02` §4 |
| phase | text | `recon` … `reporting` |
| budget | jsonb | requested caps |
| usage | jsonb | steps, attacks, model calls, tokens, seconds |
| allowed_attacks | text[] | |
| model | text | `OLLAMA_MODEL` at start |
| prompt_version | text | |
| error | jsonb | |
| created_at, started_at, finished_at | timestamptz | |

Index: `(session_id, created_at desc)`, `(status)`.

### run_events
| column | type | notes |
| --- | --- | --- |
| id | bigserial pk | also the SSE `Last-Event-ID` |
| run_id | uuid fk | |
| kind | text | `phase`, `agent_step`, `attack_started`, `attack_finished`, `verdict`, `finding`, `diagnosis`, `patch`, `degraded`, `error`, `info` |
| payload | jsonb | small, UI-ready |
| created_at | timestamptz | |

Trigger: `pg_notify('run_events', json_build_object('run_id', run_id, 'id', id)::text)` after insert.

### agent_steps
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| run_id | uuid fk | |
| step_no | int | |
| tool | text | |
| args | jsonb | validated args |
| why | text | model rationale (≤ 300 chars) |
| valid | boolean | |
| validation_errors | jsonb | |
| result_summary | jsonb | |
| model_call_id | uuid fk model_calls | |

### attacks
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| run_id | uuid fk | |
| attack_id | text | `A1`…`A9` |
| instance_id | text | BuggyBeans instance used |
| patch_id | uuid null | set for verification re-runs |
| status | text | `running`, `done`, `infra_error`, `cancelled` |
| spec | jsonb | the `AttackSpec` snapshot |
| started_at, finished_at | timestamptz | |

### trace_items
Single table for all evidence, keyed by evidence ID.

| column | type | notes |
| --- | --- | --- |
| run_id | uuid | |
| evidence_id | text | `pc-0007`, … unique per run |
| attack_id | uuid fk attacks null | |
| kind | text | `paypal_call`, `webhook_delivery`, `webhook_forward`, `browser_step`, `state_snapshot`, `truth_read`, `invariant_result`, `source_excerpt` |
| at | timestamptz | |
| summary | jsonb | small, redacted, model- and UI-ready |
| detail_ref | text | key into `trace_blobs` for large bodies/screenshots |

PK `(run_id, evidence_id)`. Index `(run_id, kind, at)`.

### trace_blobs
| column | type | notes |
| --- | --- | --- |
| key | text pk | |
| content_type | text | `application/json`, `image/jpeg`, `text/plain` |
| bytes | bytea | ≤ 1 MB; screenshots JPEG 60% |
| sha256 | text | |

(Supabase Storage is an alternative for screenshots; Postgres keeps one data path for the MVP.)

### webhook_deliveries
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| received_at | timestamptz | |
| paypal_event_id | text | not unique: the same event can arrive twice |
| event_type | text | |
| order_id | text null | correlated order |
| run_id, instance_id | null until correlated | |
| raw_body | bytea | exact bytes (needed for replay) |
| headers | jsonb | the five `PAYPAL-*` headers (signature kept; never shown in UI raw) |
| forged | boolean | true for CCT-forged events |
| evidence_id | text | `wh-…` |

### webhook_forwards
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| delivery_id | uuid fk | |
| run_id | uuid | |
| rule | jsonb | which rule caused it |
| sent_at | timestamptz | |
| status_code | int null | |
| latency_ms | int | |
| response_excerpt | text | ≤ 2 KB |
| evidence_id | text | `wf-…` |

### paypal_calls
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| run_id, instance_id | | |
| source | text | `proxy` (store's call) \| `truth` (CCT's read) |
| method, path | text | |
| request_headers | jsonb | redacted |
| request_body | jsonb | redacted |
| status_code | int null | null if upstream never answered |
| response_body | jsonb | redacted |
| paypal_request_id | text null | |
| paypal_debug_id | text null | from response headers ⚠️ |
| fault_applied | jsonb null | |
| started_at, finished_at | timestamptz | |
| evidence_id | text | `pc-…` or `tr-…` |

Index `(run_id, path)`, `(path, response_body->>'id')` for order correlation (or a separate `order_id` column filled on write — preferred).

### instances
| column | type | notes |
| --- | --- | --- |
| id | text pk | short random |
| run_id | uuid | |
| kind | text | `baseline` \| `patched` \| `reference` |
| bugs | text[] | |
| patch_id | uuid null | |
| port | int | |
| status | text | `starting`, `ready`, `stopped`, `failed` |
| started_at, stopped_at | timestamptz | |

### findings
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| run_id, attack_row_id | | |
| attack_id | text | |
| failed_invariants | text[] | |
| verdicts | jsonb | expected/actual per invariant |
| evidence | text[] | evidence IDs from the checker |
| severity | text | `high` (money or entitlement wrong), `medium` (state mismatch), `low` |
| created_at | timestamptz | |

### diagnoses
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| finding_id | uuid fk | |
| source | text | `model` \| `template` |
| body | jsonb | `Diagnosis` contract |
| evidence_valid | boolean | |
| model_call_id | uuid null | |

### patches
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| finding_id | uuid fk | |
| attempt | int | |
| source | text | `model` \| `reference` |
| diff | text | |
| guard | jsonb | `{passed, reasons[]}` |
| build | jsonb | `{passed, output_excerpt}` |
| status | text | `rejected`, `build_failed`, `verified`, `not_fixed`, `regressed` |
| verify_attack_row_id | uuid null | |
| created_at | timestamptz | |

### model_calls
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| run_id | uuid null | |
| purpose | text | `recon`, `planner`, `diagnosis`, `patch`, `explore`, `repair`, `classifier` |
| provider, model, prompt_version | text | |
| prompt_hash | text | sha256 |
| input_tokens, output_tokens | int | `estimated` flag if not reported |
| latency_ms | int | |
| outcome | text | `ok`, `invalid`, `repaired`, `failed`, `timeout` |
| prompt_redacted, response_redacted | text null | stored only when `run.kind = eval` or debug on |

### reports
| column | type | notes |
| --- | --- | --- |
| id | uuid pk | |
| run_id | uuid fk unique | |
| slug | text unique | 16 random chars (base62) |
| body | jsonb | frozen report |
| created_at | timestamptz | |

### jobs
| column | type | notes |
| --- | --- | --- |
| id | bigserial pk | |
| kind | text | `run`, `eval`, `cleanup` |
| payload | jsonb | |
| status | text | `queued`, `running`, `done`, `failed` |
| locked_by | text null | worker ID |
| lease_until | timestamptz null | |
| attempts | int | |
| created_at, updated_at | timestamptz | |

Claim: `UPDATE jobs SET status='running', locked_by=$1, lease_until=now()+interval '120 s', attempts=attempts+1 WHERE id = (SELECT id FROM jobs WHERE status='queued' OR (status='running' AND lease_until < now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.

### audit_log
| column | type | notes |
| --- | --- | --- |
| id | bigserial pk | |
| at | timestamptz | |
| actor | text | `session:<id>` \| `worker:<id>` \| `system` |
| action | text | `run.created`, `target.verified`, `patch.applied_to_instance`, … |
| data | jsonb | |

## 3. Retention

- `trace_blobs` older than 14 days deleted by the `cleanup` job, except for runs referenced by a pinned demo report (`reports.body.pinned = true`).
- Everything else kept until 31 Dec 2026, then the project may be paused.

## 4. Seed data (`pnpm seed`)

- Targets: `buggybeans:demo` (B1,B3,B4,B5,B7), `buggybeans:all`, `buggybeans:fixed`, `buggybeans:custom`.
- One pinned **demo report** from a rehearsal run, so the home page can link to a real result even if a live run is slow.

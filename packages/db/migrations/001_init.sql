-- FaultLine schema (docs/08). Server-side access only; RLS on with no policies so Supabase anon keys read nothing.

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  is_operator boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists targets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  kind text not null,
  name text not null,
  description text not null default '',
  bugs text[] not null default '{}',
  status text not null default 'ready',
  created_by_session uuid,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  session_id uuid,
  mode text not null,
  effective_mode text not null,
  status text not null,
  phase text not null,
  budget jsonb not null,
  usage jsonb not null default '{}',
  allowed_attacks text[] not null,
  model text,
  prompt_version text,
  summary jsonb,
  error jsonb,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists runs_session_idx on runs (session_id, created_at desc);
create index if not exists runs_status_idx on runs (status);

create table if not exists run_events (
  id serial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists run_events_run_idx on run_events (run_id, id);

create table if not exists agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  step_no int not null,
  tool text not null,
  args jsonb,
  why text,
  valid boolean not null,
  validation_errors jsonb,
  result_summary jsonb,
  created_at timestamptz not null default now()
);

create table if not exists attacks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  attack_id text not null,
  purpose text not null,
  instance_id text,
  patch_id uuid,
  status text not null,
  spec jsonb not null,
  verdicts jsonb,
  notes jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists trace_items (
  run_id uuid not null references runs(id) on delete cascade,
  evidence_id text not null,
  attack_row_id uuid,
  kind text not null,
  at timestamptz not null,
  summary jsonb not null,
  detail jsonb,
  primary key (run_id, evidence_id)
);
create index if not exists trace_items_kind_idx on trace_items (run_id, kind, at);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  paypal_event_id text,
  event_type text,
  order_id text,
  run_id uuid,
  instance_id text,
  raw_body bytea not null,
  headers jsonb not null,
  forged boolean not null default false,
  evidence_id text
);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  attack_row_id uuid not null references attacks(id),
  attack_id text not null,
  failed_invariants text[] not null,
  verdicts jsonb not null,
  evidence text[] not null,
  severity text not null,
  created_at timestamptz not null default now()
);

create table if not exists diagnoses (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  source text not null,
  body jsonb not null,
  evidence_valid boolean not null,
  raw_evidence_valid boolean,
  created_at timestamptz not null default now()
);

create table if not exists patches (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  attempt int not null,
  source text not null,
  diff text not null,
  guard jsonb not null,
  build jsonb,
  status text not null,
  verify_attack_row_id uuid,
  verdicts jsonb,
  created_at timestamptz not null default now()
);

create table if not exists model_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  purpose text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  prompt_hash text not null,
  input_tokens int not null,
  output_tokens int not null,
  estimated boolean not null default false,
  latency_ms int not null,
  outcome text not null,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references runs(id) on delete cascade,
  slug text not null unique,
  body jsonb not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id serial primary key,
  kind text not null,
  payload jsonb not null,
  status text not null default 'queued',
  locked_by text,
  lease_until timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status_idx on jobs (status, id);

alter table sessions enable row level security;
alter table targets enable row level security;
alter table runs enable row level security;
alter table run_events enable row level security;
alter table agent_steps enable row level security;
alter table attacks enable row level security;
alter table trace_items enable row level security;
alter table webhook_deliveries enable row level security;
alter table findings enable row level security;
alter table diagnoses enable row level security;
alter table patches enable row level security;
alter table model_calls enable row level security;
alter table reports enable row level security;
alter table jobs enable row level security;

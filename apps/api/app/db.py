"""Async Postgres access over psycopg3. The schema is owned by @faultline/db migrations."""

from __future__ import annotations

import json
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool


class Db:
    def __init__(self, pool: AsyncConnectionPool):
        self.pool = pool

    @staticmethod
    def _pool(url: str) -> AsyncConnectionPool:
        ssl = "sslmode=require" if ("supabase.co" in url or "pooler.supabase" in url) and "sslmode" not in url else None
        conninfo = f"{url}{'?' if '?' not in url else '&'}{ssl}" if ssl else url
        return AsyncConnectionPool(conninfo, min_size=1, max_size=5, kwargs={"row_factory": dict_row}, open=False)

    @classmethod
    async def connect(cls, url: str) -> "Db":
        pool = cls._pool(url)
        await pool.open(wait=True)
        return cls(pool)

    @classmethod
    def lazy(cls, url: str) -> "Db":
        """Build with an unopened pool; call open() inside a lifespan (uvicorn factory is synchronous)."""
        return cls(cls._pool(url))

    async def open(self) -> None:
        await self.pool.open(wait=True)

    async def close(self) -> None:
        await self.pool.close()

    async def _fetch(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(sql, params)
            return await cur.fetchall()

    async def one(self, sql: str, params: tuple = ()) -> dict[str, Any] | None:
        rows = await self._fetch(sql, params)
        return rows[0] if rows else None

    async def all(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        return await self._fetch(sql, params)

    async def execute(self, sql: str, params: tuple = ()) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(sql, params)

    async def ping(self) -> bool:
        try:
            await self._fetch("select 1")
            return True
        except Exception:
            return False

    # --- sessions ---

    async def create_session(self, code_hash: str, is_operator: bool, ttl_hours: int) -> dict:
        return await self.one(
            "insert into sessions (code_hash, is_operator, expires_at) "
            "values (%s, %s, now() + make_interval(hours => %s)) returning id, expires_at",
            (code_hash, is_operator, ttl_hours),
        )  # type: ignore[return-value]

    async def get_session(self, session_id: str) -> dict | None:
        return await self.one(
            "select id, is_operator, expires_at from sessions where id = %s and expires_at > now()",
            (session_id,),
        )

    async def delete_session(self, session_id: str) -> None:
        await self.execute("delete from sessions where id = %s", (session_id,))

    # --- targets ---

    async def list_targets(self, session_id: str | None) -> list[dict]:
        return await self.all(
            "select id, slug, kind, name, description, bugs, status, created_by_session "
            "from targets where created_by_session is null or created_by_session = %s order by created_at",
            (session_id,),
        )

    async def get_target(self, id_or_slug: str) -> dict | None:
        return await self.one(
            "select id, slug, kind, name, description, bugs, status, created_by_session "
            "from targets where slug = %s or id::text = %s",
            (id_or_slug, id_or_slug),
        )

    async def upsert_target(self, slug: str, kind: str, name: str, description: str, bugs: list[str], session_id: str | None) -> dict:
        return await self.one(
            "insert into targets (slug, kind, name, description, bugs, created_by_session) "
            "values (%s, %s, %s, %s, %s, %s) "
            "on conflict (slug) do update set name = excluded.name returning id, slug",
            (slug, kind, name, description, bugs, session_id),
        )  # type: ignore[return-value]

    # --- runs + jobs ---

    async def active_run(self, session_id: str) -> dict | None:
        return await self.one(
            "select id from runs where session_id = %s and status in ('queued','running') order by created_at desc limit 1",
            (session_id,),
        )

    async def create_run(self, target_id: str, session_id: str | None, mode: str, budget: dict, allowed: list[str], model: str | None) -> dict:
        return await self.one(
            "with r as ("
            "  insert into runs (target_id, session_id, mode, effective_mode, status, phase, budget, allowed_attacks, model)"
            "  values (%s, %s, %s, %s, 'queued', 'queued', %s, %s, %s) returning id"
            "), j as (insert into jobs (kind, payload) select 'run', jsonb_build_object('runId', r.id) from r)"
            " select id from r",
            (target_id, session_id, mode, mode, Jsonb(budget), allowed, model),
        )  # type: ignore[return-value]

    async def get_run(self, run_id: str) -> dict | None:
        return await self.one(
            "select r.*, t.name as target_name, t.slug as target_slug, t.kind as target_kind "
            "from runs r join targets t on t.id = r.target_id where r.id::text = %s",
            (run_id,),
        )

    async def list_runs(self, session_id: str | None, limit: int) -> list[dict]:
        return await self.all(
            "select r.id, r.mode, r.effective_mode, r.status, r.phase, r.summary, r.created_at, "
            "t.name as target_name, t.slug as target_slug "
            "from runs r join targets t on t.id = r.target_id "
            "where (%s::uuid is null or r.session_id = %s) order by r.created_at desc limit %s",
            (session_id, session_id, limit),
        )

    async def request_cancel(self, run_id: str) -> dict | None:
        return await self.one(
            "update runs set cancel_requested = true, "
            "status = case when status = 'queued' then 'cancelled' else status end, "
            "phase = case when status = 'queued' then 'done' else phase end, "
            "finished_at = case when status = 'queued' then now() else finished_at end "
            "where id::text = %s returning status",
            (run_id,),
        )

    async def list_events(self, run_id: str, after_id: int, limit: int = 2000) -> list[dict]:
        return await self.all(
            "select id, kind, payload, created_at from run_events where run_id = %s and id > %s order by id limit %s",
            (run_id, after_id, limit),
        )

    async def run_usage(self, run_id: str) -> dict | None:
        return await self.one("select usage, model, effective_mode, budget from runs where id::text = %s", (run_id,))

    # --- attacks, findings, diagnoses, patches ---

    async def list_attacks(self, run_id: str) -> list[dict]:
        return await self.all(
            "select id, attack_id, purpose, instance_id, patch_id, status, spec, verdicts, notes, started_at, finished_at "
            "from attacks where run_id = %s order by started_at",
            (run_id,),
        )

    async def list_findings(self, run_id: str) -> list[dict]:
        return await self.all(
            "select id, attack_row_id, attack_id, failed_invariants, verdicts, evidence, severity, created_at "
            "from findings where run_id = %s order by created_at",
            (run_id,),
        )

    async def get_finding(self, finding_id: str) -> dict | None:
        return await self.one(
            "select id, run_id, attack_row_id, attack_id, failed_invariants, verdicts, evidence, severity, created_at "
            "from findings where id::text = %s",
            (finding_id,),
        )

    async def latest_diagnosis(self, finding_id: str) -> dict | None:
        return await self.one(
            "select source, body, evidence_valid, raw_evidence_valid, created_at from diagnoses "
            "where finding_id = %s order by created_at desc limit 1",
            (finding_id,),
        )

    async def list_patches(self, finding_id: str) -> list[dict]:
        return await self.all(
            "select attempt, source, diff, guard, build, status, verify_attack_row_id, verdicts, created_at "
            "from patches where finding_id = %s order by created_at",
            (finding_id,),
        )

    async def list_trace(self, run_id: str, attack_row_id: str | None, kind: str | None) -> list[dict]:
        return await self.all(
            "select evidence_id, attack_row_id, kind, at, summary from trace_items "
            "where run_id = %s and (%s::uuid is null or attack_row_id = %s) and (%s::text is null or kind = %s) "
            "order by at, evidence_id",
            (run_id, attack_row_id, attack_row_id, kind, kind),
        )

    async def get_trace(self, run_id: str, evidence_id: str) -> dict | None:
        return await self.one(
            "select evidence_id, attack_row_id, kind, at, summary, detail from trace_items where run_id = %s and evidence_id = %s",
            (run_id, evidence_id),
        )

    # --- reports ---

    async def report_by_slug(self, slug: str) -> dict | None:
        return await self.one("select run_id, slug, body, pinned, created_at from reports where slug = %s", (slug,))

    async def report_for_run(self, run_id: str) -> dict | None:
        return await self.one("select slug from reports where run_id::text = %s", (run_id,))

    async def pinned_report(self) -> dict | None:
        return await self.one("select slug from reports where pinned order by created_at desc limit 1")

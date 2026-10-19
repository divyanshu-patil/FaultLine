"""API integration tests (T-API-*). Runs against a Postgres given by TEST_DATABASE_URL or DATABASE_URL.

Each test gets its own schema so runs are isolated and the suite leaves nothing behind.
"""

from __future__ import annotations

import os
import pathlib
import uuid

import httpx
import psycopg
import pytest
import pytest_asyncio
from dotenv import load_dotenv

from app.config import load_config
from app.db import Db
from app.main import create_app

load_dotenv(pathlib.Path(__file__).resolve().parents[3] / ".env")

BASE_URL = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
MIGRATION = pathlib.Path(__file__).resolve().parents[3] / "packages/db/migrations/001_init.sql"

pytestmark = pytest.mark.skipif(not BASE_URL, reason="DATABASE_URL not set")


def _with_schema(url: str, schema: str) -> str:
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}options=-csearch_path%3D{schema}"


@pytest_asyncio.fixture
async def client():
    schema = f"t_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(BASE_URL, autocommit=True) as conn:
        conn.execute(f'create schema "{schema}"')
        conn.execute(f'set search_path to "{schema}"')
        conn.execute(MIGRATION.read_text())
        conn.execute(
            "insert into targets (slug, kind, name, description, bugs) values "
            "('buggybeans:demo','buggybeans','Demo store','Five seeded bugs','{B1,B3,B4,B5,B7}'),"
            "('buggybeans:fixed','buggybeans','Fixed store','No seeded bugs','{}')"
        )
    env = {
        "DATABASE_URL": _with_schema(BASE_URL, schema),
        "SESSION_SECRET": "test-secret-at-least-16-chars",
        "ACCESS_CODES": "demo,operator-code",
        "OPERATOR_CODES": "operator-code",
    }
    config = load_config(env)
    db = await Db.connect(config.database_url)
    app = create_app(config, db)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api.test", headers={"origin": "http://api.test", "host": "api.test"}) as c:
        yield c
    await db.close()
    with psycopg.connect(BASE_URL, autocommit=True) as conn:
        conn.execute(f'drop schema "{schema}" cascade')


async def _login(client, code="demo"):
    r = await client.post("/api/session", json={"code": code}, headers={"x-fl-csrf": "1"})
    assert r.status_code == 204, r.text
    return r.headers["set-cookie"]


async def test_health_and_db(client):
    r = await client.get("/api/health?db=1")
    assert r.status_code == 200
    assert r.json()["db"] == "ok"
    assert r.json()["mode"] == "hosted"


async def test_session_login_and_guard(client):
    # unauthenticated protected route
    assert (await client.get("/api/targets")).status_code == 401
    # wrong code
    bad = await client.post("/api/session", json={"code": "nope"}, headers={"x-fl-csrf": "1"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "INVALID_CODE"
    await _login(client)
    me = await client.get("/api/me")
    assert me.status_code == 200 and me.json()["activeRunId"] is None


async def test_login_rate_limit(client):
    for _ in range(5):
        await client.post("/api/session", json={"code": "wrong"}, headers={"x-fl-csrf": "1"})
    sixth = await client.post("/api/session", json={"code": "wrong"}, headers={"x-fl-csrf": "1"})
    assert sixth.status_code == 429 and "retry-after" in {k.lower() for k in sixth.headers}


async def test_targets_hide_bugs_for_presets(client):
    await _login(client)
    targets = (await client.get("/api/targets")).json()
    slugs = {t["slug"] for t in targets}
    assert "buggybeans:demo" in slugs
    assert all("bugs" not in t for t in targets)


async def test_create_run_conflict_and_cancel(client):
    await _login(client)
    first = await client.post("/api/runs", json={"targetId": "buggybeans:demo", "mode": "checklist"}, headers={"x-fl-csrf": "1"})
    assert first.status_code == 202
    run_id = first.json()["runId"]
    dup = await client.post("/api/runs", json={"targetId": "buggybeans:demo", "mode": "agent"}, headers={"x-fl-csrf": "1"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "RUN_ALREADY_ACTIVE"
    detail = (await client.get(f"/api/runs/{run_id}")).json()
    assert detail["status"] == "queued" and detail["mode"] == "checklist"
    cancel = await client.post(f"/api/runs/{run_id}/cancel", headers={"x-fl-csrf": "1"})
    assert cancel.status_code == 202
    assert (await client.get(f"/api/runs/{run_id}")).json()["status"] == "cancelled"


async def test_csrf_required_on_writes(client):
    cookie = await _login(client)
    no_csrf = await client.post("/api/runs", json={"targetId": "buggybeans:demo", "mode": "checklist"}, headers={"cookie": cookie}, cookies=None)
    # the client keeps the cookie; drop only the csrf header
    no_csrf = await client.post("/api/runs", json={"targetId": "buggybeans:demo", "mode": "checklist"})
    assert no_csrf.status_code == 403


async def test_csrf_origin_behind_rewrite(client):
    # Behind the web app's /api rewrite, Host is the API's own but Origin is the public host,
    # forwarded as x-forwarded-host: that must be accepted. A true cross-origin Origin is refused.
    await _login(client)
    proxied = await client.post(
        "/api/runs",
        json={"targetId": "buggybeans:demo", "mode": "checklist"},
        headers={"x-fl-csrf": "1", "origin": "http://app.test", "x-forwarded-host": "app.test"},
    )
    assert proxied.status_code == 202, proxied.text
    cross = await client.post(
        "/api/runs",
        json={"targetId": "buggybeans:demo", "mode": "checklist"},
        headers={"x-fl-csrf": "1", "origin": "http://evil.test"},
    )
    assert cross.status_code == 403 and cross.json()["error"]["message"] == "Cross-origin request refused"


async def test_attacks_catalog(client):
    await _login(client)
    attacks = (await client.get("/api/attacks")).json()
    assert [a["id"] for a in attacks] == ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]
    assert attacks[0]["invariantText"]


async def test_report_public_and_404(client):
    assert (await client.get("/api/reports/does-not-exist")).status_code == 404
    assert (await client.get("/api/reports/pinned")).json()["slug"] is None

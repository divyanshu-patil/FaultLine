"""All HTTP routes for the FaultLine product API (docs/09 §1)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from . import catalog as cat
from .config import Config
from .db import Db
from .deps import RateLimiter, Session, check_csrf, client_key, get_config, get_db, hash_code, require_session
from .errors import AppError
from .models import CreateRunBody, CreateSessionBody, CustomTargetBody
from .session import clear_cookie, is_operator, make_cookie, match_code

router = APIRouter()


async def _json_body(request: Request, model):
    try:
        return model.model_validate(await request.json())
    except ValidationError as e:
        raise AppError("VALIDATION_FAILED", "Request did not validate", {"issues": json.loads(e.json())})
    except Exception:
        raise AppError("VALIDATION_FAILED", "Body must be JSON")


# ---------- health & session ----------


@router.get("/api/health")
async def health(request: Request, db: str | None = None):
    cfg: Config = get_config(request)
    out: dict[str, Any] = {"ok": True, "version": cfg.app_version, "mode": cfg.mode}
    if db == "1":
        out["db"] = "ok" if await get_db(request).ping() else "down"
    return out


@router.post("/api/session", status_code=204)
async def create_session(request: Request, response: Response):
    cfg = get_config(request)
    limiter: RateLimiter = request.app.state.limiter
    wait = limiter.hit(client_key(request, "login"), 5, 600)
    if wait:
        raise AppError("RATE_LIMITED", "Too many attempts, try again later", headers={"Retry-After": str(int(wait))})
    body: CreateSessionBody = await _json_body(request, CreateSessionBody)
    if not match_code(body.code, cfg.access_codes):
        raise AppError("INVALID_CODE", "That access code was not recognised")
    operator = is_operator(body.code, cfg.operator_codes)
    row = await get_db(request).create_session(hash_code(body.code), operator, cfg.session_ttl_hours)
    response.headers["set-cookie"] = make_cookie(str(row["id"]), cfg.session_secret, cfg.cookie_secure, cfg.session_ttl_hours)


@router.delete("/api/session", status_code=204)
async def delete_session(request: Request, response: Response, session: Session = Depends(require_session)):
    check_csrf(request)
    await get_db(request).delete_session(session.id)
    response.headers["set-cookie"] = clear_cookie(get_config(request).cookie_secure)


@router.get("/api/me")
async def me(request: Request, session: Session = Depends(require_session)):
    db = get_db(request)
    active = await db.active_run(session.id)
    row = await db.get_session(session.id)
    return {"sessionId": session.id, "isOperator": session.is_operator, "expiresAt": row["expires_at"].isoformat() if row else None, "activeRunId": str(active["id"]) if active else None}


# ---------- attacks catalog ----------


@router.get("/api/attacks")
async def attacks(_session: Session = Depends(require_session)):
    return [{**a, "invariantText": [cat.INVARIANT_TEXT[i] for i in a["invariants"]]} for a in cat.ATTACKS]


# ---------- targets ----------


def _target_view(row: dict, mode: str) -> dict:
    out = {"id": str(row["id"]), "slug": row["slug"], "kind": row["kind"], "name": row["name"], "description": row["description"], "status": row["status"]}
    # bugs are never exposed for BuggyBeans presets (AC-04); only custom targets created by this session include them
    if row["kind"] == "buggybeans" and row["slug"].endswith(":custom"):
        out["bugs"] = row["bugs"]
    return out


@router.get("/api/targets")
async def list_targets(request: Request, session: Session = Depends(require_session)):
    rows = await get_db(request).list_targets(session.id)
    return [_target_view(r, get_config(request).mode) for r in rows]


@router.post("/api/targets", status_code=201)
async def create_external_target(request: Request, session: Session = Depends(require_session)):
    check_csrf(request)
    cfg = get_config(request)
    if cfg.mode != "selfhost" or not cfg.allow_external_targets:
        raise AppError("TARGET_NOT_ALLOWED", "External targets are disabled in hosted mode")
    raise AppError("TARGET_NOT_ALLOWED", "External targets are not available in this build")


@router.post("/api/targets/custom", status_code=201)
async def create_custom_target(request: Request, session: Session = Depends(require_session)):
    check_csrf(request)
    body: CustomTargetBody = await _json_body(request, CustomTargetBody)
    bugs = sorted(set(body.bugs))
    slug = f"buggybeans:custom:{session.id[:8]}"
    db = get_db(request)
    await db.upsert_target(slug, "buggybeans", "Custom bug set", f"Seeded bugs: {', '.join(bugs)}", bugs, session.id)
    row = await db.get_target(slug)
    return {"id": str(row["id"]), "slug": slug, "bugs": bugs}


# ---------- runs ----------


def _run_summary_view(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "mode": row["mode"],
        "effectiveMode": row["effective_mode"],
        "status": row["status"],
        "phase": row["phase"],
        "summary": row["summary"],
        "createdAt": row["created_at"].isoformat(),
        "target": {"name": row["target_name"], "slug": row["target_slug"]},
    }


@router.post("/api/runs", status_code=202)
async def create_run(request: Request, session: Session = Depends(require_session)):
    check_csrf(request)
    limiter: RateLimiter = request.app.state.limiter
    wait = limiter.hit(f"runs:{session.id}", 6, 3600)
    if wait:
        raise AppError("RATE_LIMITED", "Run limit reached for this session", headers={"Retry-After": str(int(wait))})
    body: CreateRunBody = await _json_body(request, CreateRunBody)
    db = get_db(request)
    target = await db.get_target(body.targetId)
    if not target:
        raise AppError("TARGET_NOT_FOUND", "No such target")
    if get_config(request).mode == "hosted" and target["kind"] != "buggybeans":
        raise AppError("TARGET_NOT_ALLOWED", "Only built-in targets may be attacked in hosted mode")
    if await db.active_run(session.id):
        raise AppError("RUN_ALREADY_ACTIVE", "Finish or cancel your current run first")
    budget = {**cat.DEFAULT_BUDGET, **({k: v for k, v in body.budget.model_dump().items() if v is not None} if body.budget else {})}
    allowed = body.attacks or cat.MUST_ATTACKS
    model = "gemma4:31b" if body.mode == "agent" else None
    row = await db.create_run(str(target["id"]), session.id, body.mode, budget, allowed, model)
    return {"runId": str(row["id"])}


@router.get("/api/runs")
async def list_runs(request: Request, session: Session = Depends(require_session), limit: int = 20):
    rows = await get_db(request).list_runs(session.id, min(max(limit, 1), 100))
    return [_run_summary_view(r) for r in rows]


async def _load_run(request: Request, session: Session, run_id: str) -> dict:
    row = await get_db(request).get_run(run_id)
    if not row or (row["session_id"] and str(row["session_id"]) != session.id):
        raise AppError("RUN_NOT_FOUND", "No such run")
    return row


@router.get("/api/runs/{run_id}")
async def get_run(run_id: str, request: Request, session: Session = Depends(require_session)):
    db = get_db(request)
    row = await _load_run(request, session, run_id)
    attacks = await db.list_attacks(run_id)
    findings = await db.list_findings(run_id)
    report = await db.report_for_run(run_id)
    return {
        "id": str(row["id"]),
        "status": row["status"],
        "phase": row["phase"],
        "mode": row["mode"],
        "effectiveMode": row["effective_mode"],
        "model": row["model"],
        "budget": row["budget"],
        "usage": row["usage"],
        "allowedAttacks": row["allowed_attacks"],
        "summary": row["summary"],
        "error": row["error"],
        "target": {"name": row["target_name"], "slug": row["target_slug"], "kind": row["target_kind"]},
        "createdAt": row["created_at"].isoformat(),
        "attacks": [
            {"id": str(a["id"]), "attackId": a["attack_id"], "purpose": a["purpose"], "status": a["status"], "verdicts": a["verdicts"], "instanceId": a["instance_id"]}
            for a in attacks
        ],
        "findings": [_finding_view(f) for f in findings],
        "reportSlug": report["slug"] if report else None,
    }


def _finding_view(f: dict) -> dict:
    return {
        "id": str(f["id"]),
        "attackRowId": str(f["attack_row_id"]),
        "attackId": f["attack_id"],
        "failedInvariants": f["failed_invariants"],
        "verdicts": f["verdicts"],
        "evidence": f["evidence"],
        "severity": f["severity"],
    }


@router.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, request: Request, session: Session = Depends(require_session), after: int = 0):
    await _load_run(request, session, run_id)
    rows = await get_db(request).list_events(run_id, after)
    return [{"id": r["id"], "kind": r["kind"], "payload": r["payload"], "createdAt": r["created_at"].isoformat()} for r in rows]


@router.get("/api/runs/{run_id}/stream")
async def run_stream(run_id: str, request: Request, session: Session = Depends(require_session)):
    await _load_run(request, session, run_id)
    db = get_db(request)
    last = int(request.headers.get("last-event-id", "0") or "0")

    async def gen():
        nonlocal last
        yield ": connected\n\n"
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            rows = await db.list_events(run_id, last)
            for r in rows:
                last = r["id"]
                data = json.dumps({"kind": r["kind"], "payload": r["payload"]})
                yield f"id: {r['id']}\nevent: run_event\ndata: {data}\n\n"
            run = await db.get_run(run_id)
            if run and run["status"] in ("completed", "failed", "cancelled") and not rows:
                yield f"event: done\ndata: {json.dumps({'status': run['status']})}\n\n"
                break
            idle += 1
            if idle % 15 == 0:
                yield ": ping\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/api/runs/{run_id}/cancel", status_code=202)
async def cancel_run(run_id: str, request: Request, session: Session = Depends(require_session)):
    check_csrf(request)
    await _load_run(request, session, run_id)
    await get_db(request).request_cancel(run_id)
    return {"cancelling": True}


@router.get("/api/runs/{run_id}/trace")
async def run_trace(run_id: str, request: Request, session: Session = Depends(require_session), attack: str | None = None, kind: str | None = None):
    await _load_run(request, session, run_id)
    rows = await get_db(request).list_trace(run_id, attack, kind)
    return [{"evidenceId": r["evidence_id"], "attackRowId": str(r["attack_row_id"]) if r["attack_row_id"] else None, "kind": r["kind"], "at": r["at"].isoformat(), "summary": r["summary"]} for r in rows]


@router.get("/api/evidence/{run_id}/{evidence_id}")
async def get_evidence(run_id: str, evidence_id: str, request: Request, session: Session = Depends(require_session)):
    await _load_run(request, session, run_id)
    row = await get_db(request).get_trace(run_id, evidence_id)
    if not row:
        raise AppError("EVIDENCE_NOT_FOUND", "No such evidence")
    return {"evidenceId": row["evidence_id"], "kind": row["kind"], "at": row["at"].isoformat(), "summary": row["summary"], "detail": row["detail"]}


# ---------- findings ----------


@router.get("/api/findings/{finding_id}")
async def get_finding(finding_id: str, request: Request, session: Session = Depends(require_session)):
    db = get_db(request)
    f = await db.get_finding(finding_id)
    if not f:
        raise AppError("FINDING_NOT_FOUND", "No such finding")
    await _load_run(request, session, str(f["run_id"]))
    diagnosis = await db.latest_diagnosis(finding_id)
    patches = await db.list_patches(finding_id)
    return {
        **_finding_view(f),
        "runId": str(f["run_id"]),
        "diagnosis": None if not diagnosis else {"source": diagnosis["source"], "body": diagnosis["body"], "evidenceValid": diagnosis["evidence_valid"]},
        "patches": [{"attempt": p["attempt"], "source": p["source"], "diff": p["diff"], "guard": p["guard"], "build": p["build"], "status": p["status"], "verdicts": p["verdicts"]} for p in patches],
    }


# ---------- reports (public) ----------


@router.get("/api/reports/pinned")
async def pinned_report(request: Request):
    row = await get_db(request).pinned_report()
    return {"slug": row["slug"] if row else None}


@router.get("/api/reports/{slug}")
async def get_report(slug: str, request: Request, format: str | None = None):
    row = await get_db(request).report_by_slug(slug)
    if not row:
        raise AppError("REPORT_NOT_FOUND", "No such report")
    if format == "md":
        from .report_md import render_markdown

        return Response(render_markdown(row["body"]), media_type="text/markdown")
    return row["body"]

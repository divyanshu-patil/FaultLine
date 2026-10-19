"""Shared request helpers: auth dependency, CSRF/same-origin check, and a fixed-window rate limiter."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

from fastapi import Request

from .config import Config
from .db import Db
from .errors import AppError
from .session import read_cookie


@dataclass
class Session:
    id: str
    is_operator: bool


def get_db(request: Request) -> Db:
    return request.app.state.db


def get_config(request: Request) -> Config:
    return request.app.state.config


async def require_session(request: Request) -> Session:
    cfg: Config = request.app.state.config
    db: Db = request.app.state.db
    session_id = read_cookie(request.headers.get("cookie"), cfg.session_secret)
    if not session_id:
        raise AppError("UNAUTHENTICATED", "Sign in with an access code to continue")
    row = await db.get_session(session_id)
    if not row:
        raise AppError("UNAUTHENTICATED", "Your session has expired")
    return Session(id=str(row["id"]), is_operator=bool(row["is_operator"]))


def check_csrf(request: Request) -> None:
    """State-changing routes require the custom header the web client sets, plus a same-origin Origin (docs/12 §6).

    The custom x-fl-csrf header is the real protection (a browser can't set it cross-origin
    without a CORS preflight the API never grants); the Origin match is defence in depth.
    Behind the web app's same-origin /api rewrite the upstream Host is the API's own
    (api:4000) while the browser's Origin is the public host, which Next forwards as
    x-forwarded-host — so accept an Origin matching either.
    """
    if request.headers.get("x-fl-csrf") != "1":
        raise AppError("FORBIDDEN", "Missing CSRF header")
    origin = request.headers.get("origin")
    if origin:
        origin_host = origin.split("://", 1)[-1]
        allowed = {h for h in (request.headers.get("x-forwarded-host"), request.headers.get("host")) if h}
        if allowed and origin_host not in allowed:
            raise AppError("FORBIDDEN", "Cross-origin request refused")


class RateLimiter:
    def __init__(self, clock=time.time):
        self._clock = clock
        self._windows: dict[str, tuple[int, float]] = {}

    def hit(self, key: str, maximum: int, window_s: float) -> float:
        """Returns 0 when allowed, else seconds to wait."""
        now = self._clock()
        count, reset_at = self._windows.get(key, (0, 0.0))
        if reset_at <= now:
            self._windows[key] = (1, now + window_s)
            return 0.0
        count += 1
        self._windows[key] = (count, reset_at)
        return 0.0 if count <= maximum else max(1.0, reset_at - now)


def client_key(request: Request, scope: str) -> str:
    ip = (request.headers.get("x-forwarded-for", "") or (request.client.host if request.client else "")).split(",")[0].strip()
    return f"{scope}:{hashlib.sha256(ip.encode()).hexdigest()[:16]}"


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()

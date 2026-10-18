"""Environment config, validated at startup (the FastAPI counterpart of zod env parsing)."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field


def _split(value: str) -> list[str]:
    return [c.strip() for c in value.split(",") if c.strip()]


def _bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    port: int
    database_url: str
    session_secret: str
    access_codes: list[str]
    operator_codes: list[str]
    mode: str
    allow_external_targets: bool
    session_ttl_hours: int
    cookie_secure: bool
    public_report_base_url: str
    app_version: str = "0.1.0"
    extra: dict[str, str] = field(default_factory=dict)


def load_config(env: dict[str, str] | None = None) -> Config:
    e = dict(os.environ if env is None else env)
    database_url = e.get("DATABASE_URL", "").strip()
    if not database_url:
        print('{"msg":"invalid api environment","issue":"DATABASE_URL is required"}', file=sys.stderr)
        raise SystemExit(1)
    if ":6543/" in database_url:
        print('{"msg":"invalid api environment","issue":"use the session pooler (5432), not 6543"}', file=sys.stderr)
        raise SystemExit(1)
    return Config(
        port=int(e.get("PORT", "4000")),
        database_url=database_url,
        session_secret=e.get("SESSION_SECRET", "dev-session-secret-change-me-please"),
        access_codes=_split(e.get("ACCESS_CODES", "demo")),
        operator_codes=_split(e.get("OPERATOR_CODES", "")),
        mode=e.get("FAULTLINE_MODE", "hosted"),
        allow_external_targets=_bool(e.get("ALLOW_EXTERNAL_TARGETS", "false")),
        session_ttl_hours=int(e.get("SESSION_TTL_HOURS", "12")),
        cookie_secure=_bool(e.get("COOKIE_SECURE", "false")),
        public_report_base_url=e.get("PUBLIC_REPORT_BASE_URL", ""),
    )

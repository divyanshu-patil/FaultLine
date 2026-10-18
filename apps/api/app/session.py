"""Signed session cookie and constant-time access-code checks (docs/12 §6)."""

from __future__ import annotations

import hashlib
import hmac

COOKIE = "fl_session"


def _sign(value: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), value.encode(), hashlib.sha256).digest()
    import base64

    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def make_cookie(session_id: str, secret: str, secure: bool, ttl_hours: int) -> str:
    token = f"{session_id}.{_sign(session_id, secret)}"
    attrs = [f"{COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={ttl_hours * 3600}"]
    if secure:
        attrs.append("Secure")
    return "; ".join(attrs)


def clear_cookie(secure: bool) -> str:
    attrs = [f"{COOKIE}=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
    if secure:
        attrs.append("Secure")
    return "; ".join(attrs)


def read_cookie(cookie_header: str | None, secret: str) -> str | None:
    if not cookie_header:
        return None
    raw = next((c.strip() for c in cookie_header.split(";") if c.strip().startswith(f"{COOKIE}=")), None)
    if not raw:
        return None
    token = raw[len(COOKIE) + 1 :]
    dot = token.rfind(".")
    if dot < 0:
        return None
    session_id, sig = token[:dot], token[dot + 1 :]
    return session_id if hmac.compare_digest(sig, _sign(session_id, secret)) else None


def match_code(code: str, codes: list[str]) -> bool:
    ok = False
    for c in codes:
        if hmac.compare_digest(c, code):
            ok = True
    return ok


def is_operator(code: str, operator_codes: list[str]) -> bool:
    return match_code(code, operator_codes)

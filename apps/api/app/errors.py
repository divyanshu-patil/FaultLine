"""Typed API errors mapped to the status codes in docs/09."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

_STATUS = {
    "VALIDATION_FAILED": 400,
    "UNAUTHENTICATED": 401,
    "INVALID_CODE": 401,
    "FORBIDDEN": 403,
    "TARGET_NOT_ALLOWED": 403,
    "RUN_NOT_FOUND": 404,
    "TARGET_NOT_FOUND": 404,
    "FINDING_NOT_FOUND": 404,
    "REPORT_NOT_FOUND": 404,
    "EVIDENCE_NOT_FOUND": 404,
    "RUN_ALREADY_ACTIVE": 409,
    "RATE_LIMITED": 429,
    "INTERNAL": 500,
}


class AppError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None, headers: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers or {}

    @property
    def status(self) -> int:
        return _STATUS.get(self.code, 500)


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    body: dict = {"error": {"code": exc.code, "message": exc.message, "requestId": getattr(request.state, "request_id", None)}}
    if exc.details:
        body["error"]["details"] = exc.details
    return JSONResponse(status_code=exc.status, content=body, headers=exc.headers)

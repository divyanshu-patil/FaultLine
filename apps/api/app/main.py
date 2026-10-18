"""FastAPI product API. One create_app(config, db) factory so tests can inject a test database."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import Config, load_config
from .db import Db
from .deps import RateLimiter
from .errors import AppError, app_error_handler
from .routes import router


def create_app(config: Config, db: Db | None = None) -> FastAPI:
    owns_pool = db is None
    database = db or Db.lazy(config.database_url)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if owns_pool:
            await database.open()
        try:
            yield
        finally:
            if owns_pool:
                await database.close()

    app = FastAPI(title="FaultLine API", version=config.app_version, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.config = config
    app.state.db = database
    app.state.limiter = RateLimiter()

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        request.state.request_id = incoming if _is_uuid(incoming) else str(uuid.uuid4())
        try:
            response = await call_next(request)
        except AppError:
            raise
        response.headers["x-request-id"] = request.state.request_id
        # security headers (helmet-equivalent); CSP for the API responses only
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    app.add_exception_handler(AppError, app_error_handler)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):  # pragma: no cover - safety net
        rid = getattr(request.state, "request_id", None)
        return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL", "message": "Internal error", "requestId": rid}})

    app.include_router(router)
    return app


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


def app_factory() -> FastAPI:
    """Synchronous uvicorn --factory entry; the pool opens in the app lifespan."""
    load_dotenv()
    return create_app(load_config())

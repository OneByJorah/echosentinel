"""FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import __version__
from .api import auth, automation, channels, data, system, ws
from .config import Settings, get_settings
from .engine import Engine

log = logging.getLogger("echosentinel")

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "media-src 'self' blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; "
    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
)


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        resp = await call_next(request)
        h = resp.headers
        h.setdefault("content-security-policy", CSP)
        h.setdefault("x-content-type-options", "nosniff")
        h.setdefault("x-frame-options", "DENY")
        h.setdefault("referrer-policy", "no-referrer")
        h.setdefault("permissions-policy", "camera=(), microphone=(), geolocation=()")
        h.setdefault("cross-origin-opener-policy", "same-origin")
        if request.url.path.startswith("/api/"):
            h.setdefault("cache-control", "no-store")
        return resp


def create_app(cfg: Settings | None = None) -> FastAPI:
    cfg = cfg or get_settings()
    logging.basicConfig(level=cfg.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        eng = Engine(cfg)
        app.state.engine = eng
        await eng.start()
        if cfg.demo_mode:
            log.warning("DEMO MODE: synthetic data, isolated database %s", cfg.db_path)
        if not eng.box.available:
            log.warning("ES_SECRET_KEY not set: stream URLs and tokens cannot be saved")
        if not eng.db.one("SELECT id FROM users LIMIT 1"):
            log.warning("No users exist. Create one with: echosentinel create-user --username admin --role admin")
        try:
            yield
        finally:
            await eng.stop()

    app = FastAPI(title="EchoSentinel", version=__version__, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(SecurityHeaders)
    for r in (auth.router, channels.router, data.router, system.router, automation.router):
        app.include_router(r, prefix="/api/v1")
    app.include_router(ws.router)

    @app.get("/healthz", include_in_schema=False)
    async def healthz():
        return {"status": "ok"}

    @app.get("/readyz", include_in_schema=False)
    async def readyz(request: Request):
        e: Engine = request.app.state.engine
        checks = {}
        try:
            e.db.one("SELECT 1")
            checks["db"] = "ok"
        except Exception:
            checks["db"] = "fail"
        checks["recordings_dir"] = "ok" if e.cfg.rec_dir.is_dir() else "missing"
        ok = all(v == "ok" for v in checks.values())
        return JSONResponse({"status": "ok" if ok else "degraded", "checks": checks}, status_code=200 if ok else 503)

    @app.get("/metrics", include_in_schema=False)
    async def prometheus(request: Request):
        if not request.client or request.client.host not in ("127.0.0.1", "::1"):
            raise HTTPException(403, "Prometheus endpoint is loopback-only")
        e: Engine = request.app.state.engine
        p = e.pipeline_status()
        lines = ["# TYPE echosentinel_channel_online gauge"]
        for c in e.channel_views():
            lines.append(f'echosentinel_channel_online{{slot="{c["slot"]}"}} {int(c["state"] == "online")}')
        lines += [
            f"echosentinel_stt_queue {p['stt']['queue']}",
            f"echosentinel_classifier_queue {p['classifier']['queue']}",
            f"echosentinel_stt_dropped_total {p['stt']['dropped']}",
            f"echosentinel_classifier_dropped_total {p['classifier']['dropped']}",
            f"echosentinel_disk_free_bytes {p['recorder']['free_bytes']}",
            f"echosentinel_ws_clients {e.bus.subscriber_count}",
            f"echosentinel_notifications_sent_total {e.notifier.sent}",
            f"echosentinel_notifications_failed_total {e.notifier.errors}",
        ]
        return PlainTextResponse("\n".join(lines) + "\n")

    dist: Path = cfg.dist_dir
    if dist.is_dir():
        index = dist / "index.html"

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str):
            if full_path.startswith(("api/", "ws/")):
                raise HTTPException(404)
            target = (dist / full_path).resolve()
            if full_path and dist in target.parents and target.is_file():
                headers = {"cache-control": "public, max-age=31536000, immutable"} if "/assets/" in f"/{full_path}" else {}
                return FileResponse(target, headers=headers)
            return FileResponse(index, headers={"cache-control": "no-cache"})
    else:

        @app.get("/", include_in_schema=False)
        async def no_ui():
            return PlainTextResponse("EchoSentinel API is running. Frontend not built: cd frontend && npm ci && npm run build")

    return app

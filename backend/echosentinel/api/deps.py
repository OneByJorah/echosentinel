"""Auth dependencies: cookie sessions, CSRF double-submit, RBAC, client IP, audit, rate limit."""

from __future__ import annotations

import ipaddress
import json
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, WebSocket

from ..db import iso, parse_iso, utcnow
from ..engine import Engine
from ..security import token_hash

ROLE_RANK = {"viewer": 0, "operator": 1, "admin": 2}
SESSION_COOKIE = "es_session"
CSRF_COOKIE = "es_csrf"


def engine(request: Request) -> Engine:
    return request.app.state.engine


def client_ip(conn: Request | WebSocket) -> str:
    peer = conn.client.host if conn.client else "unknown"
    trusted = conn.app.state.engine.cfg.trusted_proxies
    if peer in trusted:
        fwd = conn.headers.get("x-forwarded-for")
        if fwd:
            cand = fwd.split(",")[-1].strip()
            try:
                ipaddress.ip_address(cand)
                return cand
            except ValueError:
                pass
    return peer


class RateLimiter:
    def __init__(self, limit: int, window_s: float):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True


login_limiter = RateLimiter(limit=8, window_s=300)


def create_session(e: Engine, user_id: int, ip: str) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    now = utcnow()
    e.db.insert(
        "INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at,ip) VALUES(?,?,?,?,?,?)",
        (token_hash(token), user_id, csrf, iso(now), iso(now + timedelta(hours=e.cfg.session_hours)), ip),
    )
    e.db.execute("DELETE FROM sessions WHERE expires_at < ?", (iso(now),))
    return token, csrf


def _session_user(e: Engine, token: str | None) -> dict | None:
    if not token:
        return None
    row = e.db.one(
        "SELECT s.csrf, s.expires_at, u.id, u.username, u.role, u.disabled, u.created_at, u.last_login_at "
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=?",
        (token_hash(token),),
    )
    if not row or row["disabled"]:
        return None
    exp = parse_iso(row["expires_at"])
    if not exp or exp < utcnow():
        return None
    return row


async def current_user(request: Request) -> dict:
    e = engine(request)
    user = _session_user(e, request.cookies.get(SESSION_COOKIE))
    if not user:
        raise HTTPException(401, "Not authenticated")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        header = request.headers.get("x-csrf-token", "")
        if not header or not secrets.compare_digest(header, user["csrf"]):
            raise HTTPException(403, "CSRF token missing or invalid")
    request.state.user = user
    return user


def require(role: str):
    async def dep(user: dict = Depends(current_user)) -> dict:
        if ROLE_RANK[user["role"]] < ROLE_RANK[role]:
            raise HTTPException(403, f"Requires {role} role")
        return user

    return dep


def ws_user(ws: WebSocket) -> dict | None:
    e: Engine = ws.app.state.engine
    # Cross-site WebSocket hijacking guard: Origin must match Host when present.
    origin = ws.headers.get("origin")
    host = ws.headers.get("host")
    if origin and host:
        o = origin.split("://", 1)[-1].rstrip("/")
        if o != host:
            return None
    return _session_user(e, ws.cookies.get(SESSION_COOKIE))


def audit(e: Engine, user: dict | None, action: str, target: str | None, ip: str | None, detail: dict | None = None) -> None:
    e.db.insert(
        "INSERT INTO audit_log(at,username,action,target,ip,detail) VALUES(?,?,?,?,?,?)",
        (iso(utcnow()), user["username"] if user else None, action, target, ip, json.dumps(detail) if detail else None),
    )

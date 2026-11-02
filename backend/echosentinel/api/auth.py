from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import __version__
from ..db import iso, utcnow
from ..security import hash_password, token_hash, validate_new_password, verify_password
from ..serializers import user_out
from .deps import CSRF_COOKIE, SESSION_COOKIE, audit, client_ip, create_session, current_user, engine, login_limiter

router = APIRouter()

# Constant-time-ish dummy hash so unknown usernames cost the same as wrong passwords.
_DUMMY = hash_password("echosentinel-dummy-password")


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=256)


@router.get("/meta")
async def meta(request: Request):
    e = engine(request)
    n = e.db.one("SELECT COUNT(*) AS n FROM users")
    return {"name": "EchoSentinel", "version": __version__, "demo_mode": e.cfg.demo_mode, "setup_required": (n or {"n": 0})["n"] == 0}


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    e = engine(request)
    ip = client_ip(request)
    if not login_limiter.check(f"{ip}:{body.username.lower()}") or not login_limiter.check(f"ip:{ip}"):
        raise HTTPException(429, "Too many login attempts; try again later")
    row = e.db.one("SELECT * FROM users WHERE username=?", (body.username,))
    ok = verify_password(body.password, row["password_hash"] if row else _DUMMY)
    if not row or not ok or row["disabled"]:
        audit(e, {"username": body.username}, "login_failed", None, ip)
        raise HTTPException(401, "Invalid username or password")
    token, csrf = create_session(e, row["id"], ip)
    e.db.execute("UPDATE users SET last_login_at=? WHERE id=?", (iso(utcnow()), row["id"]))
    secure = e.cfg.secure_cookies
    max_age = e.cfg.session_hours * 3600
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="strict", secure=secure, max_age=max_age, path="/")
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, samesite="strict", secure=secure, max_age=max_age, path="/")
    audit(e, row, "login", None, ip)
    return user_out(row)


@router.post("/auth/logout")
async def logout(request: Request, response: Response, user: dict = Depends(current_user)):
    e = engine(request)
    tok = request.cookies.get(SESSION_COOKIE)
    if tok:
        e.db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(tok),))
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    audit(e, user, "logout", None, client_ip(request))
    return {"ok": True}


@router.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return user_out(user)


@router.post("/auth/password")
async def change_password(body: PasswordIn, request: Request, user: dict = Depends(current_user)):
    e = engine(request)
    row = e.db.one("SELECT password_hash FROM users WHERE id=?", (user["id"],))
    if not row or not verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    try:
        validate_new_password(body.new_password)
    except ValueError as ex:
        raise HTTPException(400, str(ex)) from None
    e.db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(body.new_password), user["id"]))
    # Invalidate other sessions.
    tok = request.cookies.get(SESSION_COOKIE) or ""
    e.db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash!=?", (user["id"], token_hash(tok)))
    audit(e, user, "password_change", None, client_ip(request))
    return {"ok": True}

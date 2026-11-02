from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..db import iso, utcnow
from ..metrics import collect
from ..security import hash_password, validate_new_password
from ..serializers import user_out
from ..settings_store import RuntimeSettings
from .deps import audit, client_ip, engine, require

router = APIRouter()


@router.get("/system/metrics")
async def metrics(request: Request, user=Depends(require("viewer"))):
    e = engine(request)
    return e.metrics or collect(e.cfg.rec_dir)


@router.get("/system/pipeline")
async def pipeline(request: Request, user=Depends(require("viewer"))):
    return engine(request).pipeline_status()


@router.get("/system/audit")
async def audit_log(request: Request, limit: int = Query(100, ge=1, le=500), before_id: int | None = None, user=Depends(require("admin"))):
    e = engine(request)
    if before_id:
        rows = e.db.query("SELECT * FROM audit_log WHERE id<? ORDER BY id DESC LIMIT ?", (before_id, limit))
    else:
        rows = e.db.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))
    return {"items": rows, "next_before_id": rows[-1]["id"] if len(rows) == limit else None}


# ---------------------------------------------------------------------------- users
class UserIn(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_.-]{2,32}$")
    password: str = Field(max_length=256)
    role: Literal["admin", "operator", "viewer"]


class UserPatch(BaseModel):
    role: Literal["admin", "operator", "viewer"] | None = None
    password: str | None = Field(None, max_length=256)
    disabled: bool | None = None


@router.get("/users")
async def users(request: Request, user=Depends(require("admin"))):
    return [user_out(r) for r in engine(request).db.query("SELECT * FROM users ORDER BY id")]


@router.post("/users")
async def create_user(body: UserIn, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    try:
        validate_new_password(body.password)
    except ValueError as ex:
        raise HTTPException(400, str(ex)) from None
    if e.db.one("SELECT id FROM users WHERE username=?", (body.username,)):
        raise HTTPException(409, "Username already exists")
    uid = e.db.insert(
        "INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)",
        (body.username, hash_password(body.password), body.role, iso(utcnow())),
    )
    audit(e, user, "user_create", f"user:{body.username}", client_ip(request), {"role": body.role})
    return user_out(e.db.one("SELECT * FROM users WHERE id=?", (uid,)))  # type: ignore[arg-type]


@router.patch("/users/{uid}")
async def patch_user(uid: int, body: UserPatch, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    row = e.db.one("SELECT * FROM users WHERE id=?", (uid,))
    if not row:
        raise HTTPException(404, "User not found")
    if uid == user["id"] and (body.disabled or (body.role and body.role != "admin")):
        raise HTTPException(400, "You cannot demote or disable your own account")
    if body.role:
        e.db.execute("UPDATE users SET role=? WHERE id=?", (body.role, uid))
    if body.password:
        try:
            validate_new_password(body.password)
        except ValueError as ex:
            raise HTTPException(400, str(ex)) from None
        e.db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(body.password), uid))
        e.db.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    if body.disabled is not None:
        e.db.execute("UPDATE users SET disabled=? WHERE id=?", (int(body.disabled), uid))
        if body.disabled:
            e.db.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    audit(
        e,
        user,
        "user_update",
        f"user:{row['username']}",
        client_ip(request),
        {k: ("<redacted>" if k == "password" else v) for k, v in body.model_dump(exclude_none=True).items()},
    )
    return user_out(e.db.one("SELECT * FROM users WHERE id=?", (uid,)))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------- settings
@router.get("/settings")
async def get_settings(request: Request, user=Depends(require("viewer"))):
    return engine(request).settings.get()


@router.put("/settings")
async def put_settings(body: RuntimeSettings, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    from urllib.parse import urlsplit

    p = urlsplit(body.ollama.url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise HTTPException(422, "Ollama URL must be http(s)://host:port")
    old = e.settings.get()
    e.settings.put(body)
    audit(e, user, "settings_update", None, client_ip(request))
    if old.segment_minutes != body.segment_minutes:
        for cid in list(e.workers):
            await e.apply_channel(cid)
    e.recorder.check_disk()
    await e.ollama.refresh(body.ollama)
    e.publish_pipeline()
    return body

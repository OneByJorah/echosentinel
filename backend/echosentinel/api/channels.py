from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..channels.probe import probe
from ..db import iso, utcnow
from ..security import UrlRejected, redact_url, validate_rtsp_url
from .deps import audit, client_ip, engine, require

router = APIRouter(prefix="/channels")


class ChannelIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=48)
    url: str | None = Field(None, max_length=1024)
    transport: Literal["tcp", "udp", "auto"] | None = None
    enabled: bool | None = None
    record: bool | None = None
    transcribe: bool | None = None
    classify: bool | None = None


class TestIn(BaseModel):
    url: str | None = Field(None, max_length=1024)
    transport: Literal["tcp", "udp", "auto"] = "tcp"
    channel_id: int | None = None


def _get(e, cid: int) -> dict:
    if cid not in e.channels:
        raise HTTPException(404, "Channel not found")
    return e.channel_view(cid)


@router.get("")
async def list_channels(request: Request, user=Depends(require("viewer"))):
    return engine(request).channel_views()


@router.get("/{cid}")
async def get_channel(cid: int, request: Request, user=Depends(require("viewer"))):
    return _get(engine(request), cid)


@router.put("/{cid}")
async def update_channel(cid: int, body: ChannelIn, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    _get(e, cid)
    fields: dict = {}
    changed = body.model_dump(exclude_none=True)
    if body.url is not None:
        if body.url.strip() == "":
            fields["url_enc"], fields["url_redacted"] = None, None
        else:
            try:
                url = validate_rtsp_url(body.url, e.cfg.rtsp_allowed_networks)
            except UrlRejected as ex:
                raise HTTPException(422, str(ex)) from None
            if not e.box.available:
                raise HTTPException(409, "ES_SECRET_KEY is not configured; cannot store stream credentials")
            fields["url_enc"], fields["url_redacted"] = e.box.encrypt(url), redact_url(url)
    for k in ("name", "transport"):
        if getattr(body, k) is not None:
            fields[k] = getattr(body, k)
    for k in ("enabled", "record", "transcribe", "classify"):
        if getattr(body, k) is not None:
            fields[k] = int(getattr(body, k))
    if fields:
        fields["updated_at"] = iso(utcnow())
        sets = ", ".join(f"{k}=?" for k in fields)
        e.db.execute(f"UPDATE channels SET {sets} WHERE id=?", (*fields.values(), cid))  # noqa: S608 (keys are fixed)
        audit(e, user, "channel_update", f"channel:{cid}", client_ip(request), {k: ("<redacted>" if k == "url" else v) for k, v in changed.items()})
        await e.apply_channel(cid)
    return e.channel_view(cid)


@router.post("/{cid}/reconnect")
async def reconnect(cid: int, request: Request, user=Depends(require("operator"))):
    e = engine(request)
    _get(e, cid)
    w = e.workers.get(cid)
    if w:
        w.reconnect_now()
    else:
        await e.apply_channel(cid)
    audit(e, user, "channel_reconnect", f"channel:{cid}", client_ip(request))
    return e.channel_view(cid)


@router.post("/test")
async def test_connection(body: TestIn, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    if body.channel_id is not None:
        row = e.channels.get(body.channel_id)
        if not row:
            raise HTTPException(404, "Channel not found")
        url = e.box.decrypt(row["url_enc"])
        transport = row["transport"]
        if not url:
            raise HTTPException(422, "Channel has no stored URL")
    elif body.url:
        try:
            url = validate_rtsp_url(body.url, e.cfg.rtsp_allowed_networks)
        except UrlRejected as ex:
            return {"ok": False, "codec": None, "sample_rate": None, "channels": None, "latency_ms": None, "error": str(ex)}
        transport = body.transport
    else:
        raise HTTPException(422, "Provide url or channel_id")
    res = await probe(url, transport, e.cfg.ffprobe_path, e.cfg.connect_timeout_s)
    audit(e, user, "channel_test", redact_url(url), client_ip(request), {"ok": res.ok})
    return {
        "ok": res.ok,
        "codec": res.codec,
        "sample_rate": res.sample_rate,
        "channels": res.channels,
        "latency_ms": res.latency_ms,
        "error": res.error,
    }


@router.get("/{cid}/diagnostics")
async def diagnostics(cid: int, request: Request, user=Depends(require("operator"))):
    e = engine(request)
    _get(e, cid)
    w = e.workers.get(cid)
    log = e.db.query("SELECT state, reason, at FROM channel_status_log WHERE channel_id=? ORDER BY id DESC LIMIT 50", (cid,))
    if not w:
        return {"ffmpeg_running": False, "restarts": 0, "last_error": None, "bytes_in": 0, "uptime_s": 0, "stderr_tail": [], "status_log": log}
    s = w.status
    up = (utcnow() - s.online_since).total_seconds() if s.online_since else 0
    return {
        "ffmpeg_running": s.ffmpeg_running,
        "restarts": s.restarts,
        "last_error": s.last_error,
        "bytes_in": s.bytes_in,
        "uptime_s": int(up),
        "stderr_tail": list(s.stderr_tail),
        "status_log": log,
    }

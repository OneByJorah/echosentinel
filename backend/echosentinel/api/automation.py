from __future__ import annotations

import json
import re
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..db import iso, parse_iso, utcnow
from ..security import UrlRejected, redact_url, validate_webhook_url
from ..settings_store import CATEGORIES
from .deps import audit, client_ip, engine, require

router = APIRouter()

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class QuietHours(BaseModel):
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)


class TelegramIn(BaseModel):
    enabled: bool = False
    chat_id: str = Field("", max_length=64, pattern=r"^(-?\d+|@[A-Za-z0-9_]{4,64})?$")
    bot_token: str | None = Field(None, max_length=128)
    include_transcript: bool = False
    quiet_hours: QuietHours | None = None


@router.get("/automation/telegram")
async def get_telegram(request: Request, user=Depends(require("admin"))):
    return engine(request).notifier.telegram_config()


@router.put("/automation/telegram")
async def put_telegram(body: TelegramIn, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    if body.bot_token:
        if not re.fullmatch(r"\d{5,15}:[A-Za-z0-9_-]{20,64}", body.bot_token):
            raise HTTPException(422, "That does not look like a Telegram bot token")
        if not e.box.available:
            raise HTTPException(409, "ES_SECRET_KEY is not configured; cannot store the bot token")
        e.db.execute(
            "INSERT INTO secrets(key,value_enc) VALUES('telegram_token',?) ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc",
            (e.box.encrypt(body.bot_token),),
        )
    cfg = body.model_dump(exclude={"bot_token"})
    e.settings.put_json("telegram", cfg)
    audit(e, user, "telegram_update", None, client_ip(request), {"enabled": body.enabled, "token_changed": bool(body.bot_token)})
    return e.notifier.telegram_config()


@router.post("/automation/telegram/test")
async def test_telegram(request: Request, user=Depends(require("admin"))):
    e = engine(request)
    ok, err = await e.notifier.send_telegram("EchoSentinel test notification ✅")
    audit(e, user, "telegram_test", None, client_ip(request), {"ok": ok})
    return {"ok": ok, "error": err}


# ---------------------------------------------------------------------------- rules
class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    enabled: bool = True
    categories: list[Literal[tuple(CATEGORIES)]] = Field(default_factory=list)  # type: ignore[valid-type]
    channel_ids: list[int] = Field(default_factory=list)
    min_score: float = Field(0.5, ge=0, le=1)
    cooldown_s: int = Field(300, ge=0, le=86400)
    actions: list[Literal["telegram", "webhook"]] = Field(default_factory=lambda: ["telegram"])


def _rule_out(r: dict) -> dict:
    return {
        **r,
        "enabled": bool(r["enabled"]),
        "categories": json.loads(r["categories"]),
        "channel_ids": json.loads(r["channel_ids"]),
        "actions": json.loads(r["actions"]),
    }


@router.get("/automation/rules")
async def rules(request: Request, user=Depends(require("admin"))):
    return [_rule_out(r) for r in engine(request).db.query("SELECT * FROM rules ORDER BY id")]


@router.post("/automation/rules")
async def create_rule(body: RuleIn, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    rid = e.db.insert(
        "INSERT INTO rules(name,enabled,categories,channel_ids,min_score,cooldown_s,actions) VALUES(?,?,?,?,?,?,?)",
        (
            body.name,
            int(body.enabled),
            json.dumps(body.categories),
            json.dumps(body.channel_ids),
            body.min_score,
            body.cooldown_s,
            json.dumps(body.actions),
        ),
    )
    audit(e, user, "rule_create", f"rule:{rid}", client_ip(request))
    return _rule_out(e.db.one("SELECT * FROM rules WHERE id=?", (rid,)))  # type: ignore[arg-type]


@router.put("/automation/rules/{rid}")
async def update_rule(rid: int, body: RuleIn, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    if not e.db.one("SELECT id FROM rules WHERE id=?", (rid,)):
        raise HTTPException(404, "Rule not found")
    e.db.execute(
        "UPDATE rules SET name=?,enabled=?,categories=?,channel_ids=?,min_score=?,cooldown_s=?,actions=? WHERE id=?",
        (
            body.name,
            int(body.enabled),
            json.dumps(body.categories),
            json.dumps(body.channel_ids),
            body.min_score,
            body.cooldown_s,
            json.dumps(body.actions),
            rid,
        ),
    )
    audit(e, user, "rule_update", f"rule:{rid}", client_ip(request))
    return _rule_out(e.db.one("SELECT * FROM rules WHERE id=?", (rid,)))  # type: ignore[arg-type]


@router.delete("/automation/rules/{rid}")
async def delete_rule(rid: int, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    e.db.execute("DELETE FROM rules WHERE id=?", (rid,))
    audit(e, user, "rule_delete", f"rule:{rid}", client_ip(request))
    return {"ok": True}


# ---------------------------------------------------------------------------- webhooks
class WebhookIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    url: str = Field(max_length=2048)
    secret: str | None = Field(None, max_length=256)


@router.get("/automation/webhooks")
async def webhooks(request: Request, user=Depends(require("admin"))):
    rows = engine(request).db.query("SELECT id,name,url_redacted,enabled FROM webhooks ORDER BY id")
    return [{**r, "enabled": bool(r["enabled"])} for r in rows]


@router.post("/automation/webhooks")
async def create_webhook(body: WebhookIn, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    try:
        url = validate_webhook_url(body.url, e.cfg.webhook_allow)
    except UrlRejected as ex:
        raise HTTPException(422, str(ex)) from None
    if not e.box.available:
        raise HTTPException(409, "ES_SECRET_KEY is not configured")
    wid = e.db.insert(
        "INSERT INTO webhooks(name,url_enc,url_redacted,secret_enc) VALUES(?,?,?,?)",
        (body.name, e.box.encrypt(url), redact_url(url), e.box.encrypt(body.secret) if body.secret else None),
    )
    audit(e, user, "webhook_create", f"webhook:{wid}", client_ip(request))
    return {"id": wid, "name": body.name, "url_redacted": redact_url(url), "enabled": True}


@router.delete("/automation/webhooks/{wid}")
async def delete_webhook(wid: int, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    e.db.execute("DELETE FROM webhooks WHERE id=?", (wid,))
    audit(e, user, "webhook_delete", f"webhook:{wid}", client_ip(request))
    return {"ok": True}


# ---------------------------------------------------------------------------- summaries
class SummaryIn(BaseModel):
    channel_id: int | None = None
    start: str
    end: str


def _summary_out(r: dict) -> dict:
    return {**r, "citations": json.loads(r["citations"]), "ai_generated": True}


@router.get("/summaries")
async def summaries(request: Request, user=Depends(require("viewer"))):
    rows = engine(request).db.query("SELECT * FROM summaries ORDER BY id DESC LIMIT 50")
    return [_summary_out(r) for r in rows]


@router.post("/summaries")
async def create_summary(body: SummaryIn, request: Request, user=Depends(require("operator"))):
    e = engine(request)
    cfg = e.settings.get().ollama
    if not cfg.enabled:
        raise HTTPException(409, "Ollama integration is disabled in Settings")
    s, en = parse_iso(body.start), parse_iso(body.end)
    if not s or not en or en <= s:
        raise HTTPException(422, "Invalid time window")
    params: list = [iso(s), iso(en)]
    chan = ""
    if body.channel_id:
        chan = " AND channel_id=?"
        params.append(body.channel_id)
    segs = await e.db.aquery(f"SELECT * FROM segments WHERE start>=? AND start<?{chan} ORDER BY start", tuple(params))  # noqa: S608
    evs = await e.db.aquery(f"SELECT * FROM events WHERE at>=? AND at<?{chan} AND status!='dismissed' ORDER BY at", tuple(params))  # noqa: S608
    try:
        text, cites = await e.ollama.summarise(cfg, segs, evs)
    except httpx.HTTPError as ex:
        raise HTTPException(502, f"Ollama request failed: {type(ex).__name__}") from None
    sid = e.db.insert(
        "INSERT INTO summaries(created_at,start,end,channel_id,model,text,citations) VALUES(?,?,?,?,?,?,?)",
        (iso(utcnow()), iso(s), iso(en), body.channel_id, cfg.model, text, json.dumps(cites)),
    )
    audit(e, user, "summary_create", f"summary:{sid}", client_ip(request))
    return _summary_out(e.db.one("SELECT * FROM summaries WHERE id=?", (sid,)))  # type: ignore[arg-type]

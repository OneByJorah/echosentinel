"""Alert rules -> Telegram / webhooks. Minimal sensitive content by default."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime

import httpx

from .db import Database
from .security import SecretBox, validate_webhook_url
from .settings_store import SettingsStore

log = logging.getLogger(__name__)

CATEGORY_NAMES = {
    "speech": "Human speech",
    "barking": "Barking",
    "alarm_siren": "Alarm / siren",
    "glass_break": "Glass breaking",
    "gunshot_like": "Gunshot-like sound",
    "distress": "Scream / distress",
    "vehicle": "Vehicle",
    "knock": "Knocking",
}

DEFAULT_TELEGRAM = {"enabled": False, "chat_id": "", "include_transcript": False, "quiet_hours": None}


def in_quiet_hours(qh: dict | None, now: datetime | None = None) -> bool:
    if not qh or not qh.get("start") or not qh.get("end"):
        return False
    now = now or datetime.now()
    cur = now.hour * 60 + now.minute
    sh, sm = map(int, qh["start"].split(":"))
    eh, em = map(int, qh["end"].split(":"))
    s, e = sh * 60 + sm, eh * 60 + em
    return (s <= cur < e) if s <= e else (cur >= s or cur < e)


class Notifier:
    def __init__(self, db: Database, settings: SettingsStore, box: SecretBox, webhook_allow: list[str]):
        self.db, self.settings, self.box, self.webhook_allow = db, settings, box, webhook_allow
        self._last: dict[tuple[int, int], float] = {}
        self.sent = 0
        self.errors = 0

    # ------------------------------------------------------------------ telegram config
    def telegram_config(self) -> dict:
        cfg = self.settings.get_json("telegram", DEFAULT_TELEGRAM)
        tok = self.db.one("SELECT value_enc FROM secrets WHERE key='telegram_token'")
        cfg["token_set"] = bool(tok)
        return cfg

    def _telegram_token(self) -> str | None:
        row = self.db.one("SELECT value_enc FROM secrets WHERE key='telegram_token'")
        return self.box.decrypt(row["value_enc"]) if row else None

    async def send_telegram(self, text: str) -> tuple[bool, str | None]:
        cfg = self.telegram_config()
        token = self._telegram_token()
        if not token or not cfg.get("chat_id"):
            return False, "Telegram bot token or chat id not configured"
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as c:
                r = await c.post(
                    f"https://api.telegram.org/bot{token}/sendMessage",
                    json={"chat_id": cfg["chat_id"], "text": text, "disable_web_page_preview": True},
                )
            if r.status_code != 200:
                desc = f"HTTP {r.status_code}"
                if r.headers.get("content-type", "").startswith("application/json"):
                    desc = r.json().get("description", desc)
                return False, desc[:200]
            return True, None
        except httpx.HTTPError as e:
            return False, type(e).__name__  # never echo the URL (contains the token)

    async def send_webhook(self, hook: dict, payload: dict) -> tuple[bool, str | None]:
        url = self.box.decrypt(hook["url_enc"])
        if not url:
            return False, "cannot decrypt URL"
        try:
            validate_webhook_url(url, self.webhook_allow)  # re-check at send time (DNS rebinding)
        except ValueError as e:
            return False, str(e)
        body = json.dumps(payload).encode()
        headers = {"content-type": "application/json", "user-agent": "EchoSentinel"}
        secret = self.box.decrypt(hook.get("secret_enc"))
        if secret:
            headers["x-echosentinel-signature"] = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as c:
                r = await c.post(url, content=body, headers=headers)
            return (200 <= r.status_code < 300), (None if r.status_code < 300 else f"HTTP {r.status_code}")
        except httpx.HTTPError as e:
            return False, type(e).__name__

    # ------------------------------------------------------------------ rules
    def handle_event(self, ev: dict, channel_name: str) -> None:
        asyncio.create_task(self._handle(ev, channel_name))

    async def _handle(self, ev: dict, channel_name: str) -> None:
        rules = await self.db.aquery("SELECT * FROM rules WHERE enabled=1")
        tg = self.telegram_config()
        for r in rules:
            cats, chans = json.loads(r["categories"]), json.loads(r["channel_ids"])
            if cats and ev["category"] not in cats:
                continue
            if chans and ev["channel_id"] not in chans:
                continue
            if (ev.get("score") or 0) < r["min_score"]:
                continue
            key = (r["id"], ev["channel_id"])
            now = time.monotonic()
            if now - self._last.get(key, -1e9) < r["cooldown_s"]:
                continue
            self._last[key] = now
            actions = json.loads(r["actions"])
            name = CATEGORY_NAMES.get(ev["category"], ev["category"])
            text = f"EchoSentinel: {name} on {channel_name} at {ev['at'][11:19]} UTC (score {ev.get('score')})"
            if "telegram" in actions and tg.get("enabled") and not in_quiet_hours(tg.get("quiet_hours")):
                ok, err = await self.send_telegram(text)
                self._count(ok, err)
            if "webhook" in actions:
                for h in await self.db.aquery("SELECT * FROM webhooks WHERE enabled=1"):
                    payload = {
                        "type": "event",
                        "channel": channel_name,
                        "event": {k: ev[k] for k in ("id", "channel_id", "at", "category", "label", "score")},
                    }
                    ok, err = await self.send_webhook(h, payload)
                    self._count(ok, err)

    def _count(self, ok: bool, err: str | None) -> None:
        if ok:
            self.sent += 1
        else:
            self.errors += 1
            log.warning("notification failed: %s", err)

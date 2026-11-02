"""Operator-editable runtime settings persisted in the DB (distinct from env config)."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from .db import Database

CATEGORIES = [
    "speech",
    "barking",
    "alarm_siren",
    "glass_break",
    "gunshot_like",
    "distress",
    "vehicle",
    "knock",
]


class Threshold(BaseModel):
    threshold: float = Field(0.5, ge=0.05, le=0.99)
    cooldown_s: int = Field(60, ge=0, le=86400)
    enabled: bool = True


# Conservative defaults: high thresholds + cooldowns to keep false alarms rare.
DEFAULT_THRESHOLDS: dict[str, Threshold] = {
    "speech": Threshold(threshold=0.8, cooldown_s=300, enabled=False),
    "barking": Threshold(threshold=0.5, cooldown_s=60),
    "alarm_siren": Threshold(threshold=0.5, cooldown_s=120),
    "glass_break": Threshold(threshold=0.55, cooldown_s=30),
    "gunshot_like": Threshold(threshold=0.6, cooldown_s=30),
    "distress": Threshold(threshold=0.6, cooldown_s=60),
    "vehicle": Threshold(threshold=0.6, cooldown_s=120),
    "knock": Threshold(threshold=0.55, cooldown_s=60),
}


class OllamaSettings(BaseModel):
    enabled: bool = True
    url: str = "http://127.0.0.1:11434"
    model: str = "llama3.2"
    timeout_s: int = Field(60, ge=5, le=600)


class RuntimeSettings(BaseModel):
    retention_days: int = Field(30, ge=1, le=3650)
    max_storage_gb: float = Field(200, ge=1)
    min_free_gb: float = Field(5, ge=0.5)
    segment_minutes: int = Field(60, ge=5, le=240)
    transcript_retention_days: int = Field(30, ge=1, le=3650)
    thresholds: dict[str, Threshold] = Field(default_factory=lambda: dict(DEFAULT_THRESHOLDS))
    stt_language: str = "auto"
    redact_notifications: bool = True
    ollama: OllamaSettings = Field(default_factory=OllamaSettings)


class SettingsStore:
    KEY = "runtime"

    def __init__(self, db: Database):
        self.db = db
        self._cache: RuntimeSettings | None = None

    def get(self) -> RuntimeSettings:
        if self._cache is None:
            row = self.db.one("SELECT value FROM settings WHERE key=?", (self.KEY,))
            data: dict[str, Any] = json.loads(row["value"]) if row else {}
            s = RuntimeSettings.model_validate(data)
            for k, v in DEFAULT_THRESHOLDS.items():
                s.thresholds.setdefault(k, v)
            self._cache = s
        return self._cache

    def put(self, s: RuntimeSettings) -> RuntimeSettings:
        self.db.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (self.KEY, s.model_dump_json()),
        )
        self._cache = s
        return s

    # generic small JSON blobs (telegram config etc.)
    def get_json(self, key: str, default: Any) -> Any:
        row = self.db.one("SELECT value FROM settings WHERE key=?", (key,))
        return json.loads(row["value"]) if row else default

    def put_json(self, key: str, value: Any) -> None:
        self.db.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )

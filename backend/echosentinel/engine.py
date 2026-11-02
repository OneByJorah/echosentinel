"""Composition root: owns channels, workers, pipeline, recorder, notifier and background loops."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import timedelta

from .audio.classifier import Classifier
from .audio.pipeline import Pipeline
from .audio.stt import SttEngine
from .bus import AudioFanout, Bus
from .channels.worker import ChannelWorker, WorkerConfig, WorkerStatus, status_dict
from .config import Settings
from .db import Database, iso, utcnow
from .metrics import collect
from .notify import Notifier
from .ollama import OllamaClient
from .recorder import Recorder
from .security import SecretBox
from .settings_store import SettingsStore

log = logging.getLogger(__name__)

DEMO_INPUT = [
    "-re",
    "-f",
    "lavfi",
    "-i",
    # Synthetic, clearly-not-real signal: gated tone bursts + light noise.
    "aevalsrc='0.35*sin(2*PI*180*t)*sin(2*PI*3*t)*gt(sin(2*PI*0.21*t),0.2)"
    "+0.25*sin(2*PI*900*t)*gt(sin(2*PI*0.05*t),0.97)+0.01*(random(0)-0.5)':s=16000:c=mono",
]


class Engine:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        cfg.data_dir.mkdir(parents=True, exist_ok=True)
        self.db = Database(cfg.db_path)
        # Demo DB is isolated and holds only fake URLs, so a fixed key is acceptable there.
        self.box = SecretBox(cfg.secret_key or ("echosentinel-demo-only" if cfg.demo_mode else None))
        self.bus = Bus()
        self.fanout = AudioFanout()
        self.settings = SettingsStore(self.db)
        self.stt = SttEngine(
            cfg.stt_model,
            cfg.stt_device,
            cfg.stt_compute_type,
            str(cfg.stt_model_dir) if cfg.stt_model_dir else str(cfg.model_dir / "whisper"),
            cfg.stt_enabled and not cfg.demo_mode,
        )
        self.classifier = Classifier(cfg.yamnet_path, cfg.classifier_enabled and not cfg.demo_mode)
        self.notifier = Notifier(self.db, self.settings, self.box, cfg.webhook_allow)
        self.ollama = OllamaClient()
        self.workers: dict[int, ChannelWorker] = {}
        self.channels: dict[int, dict] = {}
        self.events_today: dict[int, int] = {}
        self.pipeline = Pipeline(
            self.db,
            self.bus,
            self.fanout,
            self.settings,
            self.stt,
            self.classifier,
            on_peak_second=lambda ch, sec, pk: self.recorder.add_peak(ch, sec, pk),
            on_event=self._on_event,
        )
        self.recorder = Recorder(
            self.db,
            cfg.rec_dir,
            self.settings,
            cfg.ffmpeg_path,
            cfg.ffprobe_path,
            slot_to_channel=self._slot_to_channel,
            is_recording=lambda ch: bool(self.workers.get(ch) and self.workers[ch].status.recording),
            notify=self.notify,
            on_record_allowed_change=self._on_record_allowed,
        )
        self._tasks: list[asyncio.Task] = []
        self._snapshot_pending = False
        self.metrics: dict | None = None
        self.demo = None
        self._last_state: dict[int, str] = {}
        self._ever_online: set[int] = set()
        self._last_seen_cache: dict[int, str] = {}
        self._notif_id = 0
        self._ensure_slots()
        self.load_last_seen()

    # ------------------------------------------------------------------ setup
    def _ensure_slots(self) -> None:
        now = iso(utcnow())
        for slot in range(1, self.cfg.channel_slots + 1):
            if not self.db.one("SELECT id FROM channels WHERE slot=?", (slot,)):
                self.db.insert("INSERT INTO channels(slot,name,updated_at) VALUES(?,?,?)", (slot, f"Audio {slot}", now))
        for r in self.db.query("SELECT * FROM channels WHERE slot<=? ORDER BY slot", (self.cfg.channel_slots,)):
            self.channels[r["id"]] = r
        if self.cfg.demo_mode:
            self._seed_demo_channels()

    def _seed_demo_channels(self) -> None:
        names = ["Front Porch (demo)", "Garage (demo)", "Backyard (demo)", "Side Gate (demo)"]
        for i, (cid, row) in enumerate(sorted(self.channels.items(), key=lambda kv: kv[1]["slot"])):
            if row["url_enc"] or i >= len(names):
                continue
            url = "rtsp://127.0.0.1:1/demo-offline"  # nothing listens here -> genuinely offline
            enc = self.box.encrypt(url) if self.box.available else None
            self.db.execute(
                "UPDATE channels SET name=?, url_enc=?, url_redacted=? WHERE id=?",
                (names[i], enc, "demo://synthetic" if i == 0 else url, cid),
            )
            self.channels[cid] = self.db.one("SELECT * FROM channels WHERE id=?", (cid,)) or row

    def _slot_to_channel(self, slot: int) -> int | None:
        for cid, r in self.channels.items():
            if r["slot"] == slot:
                return cid
        return None

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        self.bus.loop = asyncio.get_running_loop()
        await self._refresh_events_today()
        self.pipeline.start()
        self.recorder.start()
        for cid in sorted(self.channels):
            await self.apply_channel(cid)
        self._tasks = [
            asyncio.create_task(self._load_models(), name="model-load"),
            asyncio.create_task(self._metrics_loop(), name="metrics"),
            asyncio.create_task(self._ollama_loop(), name="ollama"),
            asyncio.create_task(self._midnight_loop(), name="daily"),
        ]
        if self.cfg.demo_mode:
            from .demo import DemoGenerator

            self.demo = DemoGenerator(self)
            self._tasks.append(asyncio.create_task(self.demo.run(), name="demo"))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        await asyncio.gather(*(w.stop() for w in self.workers.values()), return_exceptions=True)
        await self.pipeline.stop()
        await self.recorder.stop()
        self.db.close()

    async def _load_models(self) -> None:
        await asyncio.to_thread(self.classifier.load)
        self.publish_pipeline()
        await asyncio.to_thread(self.stt.load)
        self.publish_pipeline()

    async def _metrics_loop(self) -> None:
        while True:
            self.metrics = await asyncio.to_thread(collect, self.cfg.rec_dir)
            self.bus.publish({"type": "metrics", **self.metrics})
            await asyncio.sleep(5)

    async def _ollama_loop(self) -> None:
        while True:
            prev = (self.ollama.state, self.ollama.detail)
            await self.ollama.refresh(self.settings.get().ollama)
            if prev != (self.ollama.state, self.ollama.detail):
                self.publish_pipeline()
            await asyncio.sleep(30)

    async def _midnight_loop(self) -> None:
        while True:
            await asyncio.sleep(300)
            await self._refresh_events_today()

    async def _refresh_events_today(self) -> None:
        start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        rows = await self.db.aquery("SELECT channel_id, COUNT(*) AS n FROM events WHERE at>=? GROUP BY channel_id", (iso(start),))
        self.events_today = {r["channel_id"]: r["n"] for r in rows}

    # ------------------------------------------------------------------ channels
    async def apply_channel(self, cid: int) -> None:
        old = self.workers.pop(cid, None)
        if old:
            await old.stop()
        self.pipeline.reset_channel(cid)
        row = self.db.one("SELECT * FROM channels WHERE id=?", (cid,))
        if not row:
            return
        self.channels[cid] = row
        self.pipeline.set_channel_flags(cid, bool(row["transcribe"]), bool(row["classify"]))
        if not row["enabled"]:
            self._log_state(cid, "disabled", None)
            self.schedule_snapshot()
            return
        url = self.box.decrypt(row["url_enc"])
        input_args = None
        if self.cfg.demo_mode and row["slot"] == 1:
            input_args = DEMO_INPUT
        if not url and not input_args:
            self._log_state(cid, "unconfigured", None)
            self.schedule_snapshot()
            return
        w = ChannelWorker(
            WorkerConfig(
                channel_id=cid,
                slot=row["slot"],
                url=url,
                transport=row["transport"],
                record=bool(row["record"]),
                input_args=input_args,
                segment_seconds=self.settings.get().segment_minutes * 60,
            ),
            ffmpeg=self.cfg.ffmpeg_path,
            ffprobe=self.cfg.ffprobe_path,
            rec_dir=self.cfg.rec_dir,
            connect_timeout_s=self.cfg.connect_timeout_s,
            backoff_base_s=self.cfg.reconnect_base_s,
            backoff_max_s=self.cfg.reconnect_max_s,
            on_pcm=self.pipeline.on_pcm,
            on_state=self._on_state,
            record_allowed=lambda: self.recorder.record_allowed,
            record_rate=self.cfg.record_sample_rate,
            record_bitrate=self.cfg.record_bitrate,
        )
        self.workers[cid] = w
        w.start()

    def _log_state(self, cid: int, state: str, reason: str | None) -> None:
        if self._last_state.get(cid) == state:
            return
        self._last_state[cid] = state
        self.db.insert(
            "INSERT INTO channel_status_log(channel_id,state,reason,at) VALUES(?,?,?,?)",
            (cid, state, reason, iso(utcnow())),
        )
        name = self.channels.get(cid, {}).get("name", f"Channel {cid}")
        if state == "online":
            self._ever_online.add(cid)
            self._last_seen_cache[cid] = iso(utcnow()) or ""
            self.notify("info", f"{name} online", "Audio stream connected.")
        elif state in ("offline", "error") and cid in self._ever_online:
            self.notify("warning", f"{name} {state}", reason or "Stream lost")

    def _on_state(self, cid: int, st: WorkerStatus) -> None:
        if st.state in ("online", "offline", "error", "unconfigured"):
            self._log_state(cid, st.state, st.reason)
        self.schedule_snapshot()

    def schedule_snapshot(self) -> None:
        if self._snapshot_pending or self.bus.loop is None:
            return
        self._snapshot_pending = True

        def fire() -> None:
            self._snapshot_pending = False
            self.bus.publish({"type": "channels", "channels": self.channel_views()})

        self.bus.loop.call_later(0.15, fire)

    def channel_view(self, cid: int) -> dict:
        r = self.channels[cid]
        w = self.workers.get(cid)
        if not r["enabled"]:
            st = {"state": "disabled", "state_reason": "Disabled by operator"}
        elif w is None:
            st = {"state": "unconfigured", "state_reason": "No RTSP URL configured"}
        else:
            st = status_dict(w.status)
        base = {
            "codec": None,
            "sample_rate": None,
            "channels": None,
            "latency_ms": None,
            "last_packet_at": None,
            "last_seen_at": None,
            "online_since": None,
            "retry_at": None,
            "retry_attempt": 0,
            "recording": False,
        }
        last_seen = self._last_seen_cache.get(cid)
        out = {
            "id": cid,
            "slot": r["slot"],
            "name": r["name"],
            "enabled": bool(r["enabled"]),
            "url_redacted": r["url_redacted"],
            "transport": r["transport"],
            "record": bool(r["record"]),
            "transcribe": bool(r["transcribe"]),
            "classify": bool(r["classify"]),
            **base,
            **st,
            "events_today": self.events_today.get(cid, 0),
            "demo": self.cfg.demo_mode,
        }
        if not out["last_seen_at"] and last_seen:
            out["last_seen_at"] = last_seen
        return out

    def load_last_seen(self) -> None:
        for r in self.db.query("SELECT channel_id, MAX(at) AS at FROM channel_status_log WHERE state='online' GROUP BY channel_id"):
            self._last_seen_cache[r["channel_id"]] = r["at"]

    def channel_views(self) -> list[dict]:
        return [self.channel_view(cid) for cid in sorted(self.channels, key=lambda c: self.channels[c]["slot"])]

    def _on_record_allowed(self, allowed: bool) -> None:
        for w in self.workers.values():
            if w.cfg.record and w.status.state == "online":
                w.restart_ffmpeg()
        self.publish_pipeline()

    # ------------------------------------------------------------------ events / notifications
    def _on_event(self, ev: dict) -> None:
        self.events_today[ev["channel_id"]] = self.events_today.get(ev["channel_id"], 0) + 1
        self.schedule_snapshot()
        name = self.channels.get(ev["channel_id"], {}).get("name", f"CH{ev['channel_id']}")
        self.notifier.handle_event(ev, name)

    def notify(self, level: str, title: str, body: str) -> None:
        self._notif_id += 1
        self.bus.publish(
            {
                "type": "notification",
                "id": self._notif_id,
                "level": level,
                "title": title,
                "body": body,
                "at": iso(utcnow()),
            }
        )

    # ------------------------------------------------------------------ status
    def pipeline_status(self) -> dict:
        p = self.pipeline.status()
        o = self.settings.get().ollama
        free = self.recorder.disk_free()
        any_rec = any(w.status.recording for w in self.workers.values())
        rec_state = "degraded" if not self.recorder.record_allowed else ("active" if any_rec else "stopped")
        online = sum(1 for w in self.workers.values() if w.status.state == "online")
        return {
            "stt": {
                "state": self.stt.state,
                "engine": "faster-whisper",
                "model": self.stt.model_name,
                "device": self.stt.device,
                "detail": self.stt.detail,
                "queue": p["stt_queue"],
                "latency_ms_p50": p["stt_p50"],
                "dropped": p["stt_dropped"],
            },
            "classifier": {
                "state": self.classifier.state,
                "engine": "yamnet-tflite",
                "model": self.classifier.model_path.name,
                "detail": self.classifier.detail,
                "queue": p["cls_queue"],
                "latency_ms_p50": p["cls_p50"],
                "dropped": p["cls_dropped"],
            },
            "vad": {"state": "ready", "engine": self.pipeline.vad.engine},
            "ollama": {
                "state": self.ollama.state,
                "url_host": self.ollama.host_of(o.url),
                "model": o.model,
                "models": self.ollama.models,
                "detail": self.ollama.detail,
            },
            "recorder": {
                "state": rec_state,
                "detail": self.recorder.state_detail,
                "free_bytes": free,
                "min_free_bytes": int(self.settings.get().min_free_gb * 1024**3),
            },
            "streams": {"online": online, "total": len(self.channels)},
            "diarization": {"state": "unavailable"},
        }

    def publish_pipeline(self) -> None:
        self.bus.publish({"type": "pipeline", **self.pipeline_status()})

    def today_start(self):
        return utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    def window(self, rng: str):
        days = {"24h": 1, "7d": 7, "30d": 30}.get(rng, 1)
        end = utcnow()
        return end - timedelta(days=days), end

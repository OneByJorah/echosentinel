"""Per-channel analysis pipeline with bounded queues and backpressure.

PCM chunk (100 ms) ─┬─ level meter ───────────────► bus "levels"
                    ├─ live listeners (fan-out)
                    ├─ per-second peak index ──────► recorder (timeline waveform)
                    ├─ energy segmenter ─► Silero confirm ─► STT queue ─► segments
                    └─ sliding 0.975 s window ─► classifier queue ─► scored events
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime

import numpy as np

from ..bus import AudioFanout, Bus
from ..db import Database, iso
from ..settings_store import SettingsStore
from .classifier import WINDOW, Classifier
from .levels import pcm_to_float, peaks_and_rms
from .stt import SttEngine
from .vad import EnergySegmenter, SileroConfirm, Utterance

log = logging.getLogger(__name__)

HOP = 8000  # classify every 0.5 s


class LatencyStats:
    def __init__(self, n: int = 200):
        self.samples: deque[float] = deque(maxlen=n)

    def add(self, ms: float) -> None:
        self.samples.append(ms)

    def pct(self, p: float) -> int | None:
        if not self.samples:
            return None
        return int(np.percentile(np.fromiter(self.samples, float), p))


class Pipeline:
    def __init__(
        self,
        db: Database,
        bus: Bus,
        fanout: AudioFanout,
        settings: SettingsStore,
        stt: SttEngine,
        classifier: Classifier,
        on_peak_second: Callable[[int, int, int], None],
        on_event: Callable[[dict], None],
    ):
        self.db, self.bus, self.fanout, self.settings = db, bus, fanout, settings
        self.stt, self.classifier = stt, classifier
        self.on_peak_second = on_peak_second
        self.on_event = on_event
        self.vad = SileroConfirm()
        self.segmenters: dict[int, EnergySegmenter] = {}
        self.cls_buf: dict[int, np.ndarray] = {}
        self.cls_ts: dict[int, float] = {}
        self.sec_peak: dict[int, tuple[int, int]] = {}
        self.flags: dict[int, dict[str, bool]] = {}
        self.stt_q: asyncio.Queue[Utterance] = asyncio.Queue(maxsize=12)
        self.cls_q: asyncio.Queue[tuple[int, float, np.ndarray]] = asyncio.Queue(maxsize=16)
        self.stt_latency = LatencyStats()
        self.cls_latency = LatencyStats()
        self.stt_dropped = 0
        self.cls_dropped = 0
        self.last_fire: dict[tuple[int, str], float] = {}
        self._tasks: list[asyncio.Task] = []

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._stt_loop(), name="stt"),
            asyncio.create_task(self._cls_loop(), name="classifier"),
        ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t

    def set_channel_flags(self, channel_id: int, transcribe: bool, classify: bool) -> None:
        self.flags[channel_id] = {"transcribe": transcribe, "classify": classify}

    # ------------------------------------------------------------------ hot path (event loop)
    def on_pcm(self, channel_id: int, pcm: bytes, ts: float) -> None:
        samples = pcm_to_float(pcm)
        chunk_start = ts - len(samples) / 16000
        peaks, rms = peaks_and_rms(samples)
        self.bus.publish({"type": "levels", "channel_id": channel_id, "t_ms": int(ts * 1000), "peaks": peaks, "rms": rms})
        self.fanout.push(channel_id, pcm)

        # per-second peak for the recording index (0..255)
        sec = int(ts)
        pk = int(min(255, (max(peaks) if peaks else 0) * 255))
        prev = self.sec_peak.get(channel_id)
        if prev and prev[0] != sec:
            self.on_peak_second(channel_id, prev[0], prev[1])
            self.sec_peak[channel_id] = (sec, pk)
        else:
            self.sec_peak[channel_id] = (sec, max(pk, prev[1] if prev else 0))

        flags = self.flags.get(channel_id, {"transcribe": True, "classify": True})
        if flags["transcribe"] and self.stt.ready:
            seg = self.segmenters.setdefault(channel_id, EnergySegmenter(channel_id))
            utt = seg.feed(samples, chunk_start)
            if utt is not None:
                self._enqueue(self.stt_q, utt, "stt")
        if flags["classify"] and self.classifier.ready:
            buf = self.cls_buf.get(channel_id)
            buf = samples if buf is None else np.concatenate([buf, samples])
            if channel_id not in self.cls_ts:
                self.cls_ts[channel_id] = chunk_start
            while len(buf) >= WINDOW:
                self._enqueue(self.cls_q, (channel_id, self.cls_ts[channel_id], buf[:WINDOW].copy()), "cls")
                buf = buf[HOP:]
                self.cls_ts[channel_id] += HOP / 16000
            self.cls_buf[channel_id] = buf

    def reset_channel(self, channel_id: int) -> None:
        self.segmenters.pop(channel_id, None)
        self.cls_buf.pop(channel_id, None)
        self.cls_ts.pop(channel_id, None)
        self.sec_peak.pop(channel_id, None)

    def _enqueue(self, q: asyncio.Queue, item, kind: str) -> None:
        if q.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                q.get_nowait()
            if kind == "stt":
                self.stt_dropped += 1
            else:
                self.cls_dropped += 1
        q.put_nowait(item)

    # ------------------------------------------------------------------ STT worker
    async def _stt_loop(self) -> None:
        while True:
            utt = await self.stt_q.get()
            try:
                await self._handle_utterance(utt)
            except Exception:
                log.exception("STT failure")

    async def _handle_utterance(self, utt: Utterance) -> None:
        if self.vad.available:
            speech_s = await asyncio.to_thread(self.vad.speech_seconds, utt.audio)
            if speech_s is not None and speech_s < 0.25:
                return  # loud, but not speech — the classifier covers non-speech sounds
        lang = self.settings.get().stt_language
        t0 = time.monotonic()
        segs = await asyncio.to_thread(self.stt.transcribe, utt.audio, lang)
        latency = (time.monotonic() - t0) * 1000
        self.stt_latency.add(latency)
        for s in segs:
            start = datetime.fromtimestamp(utt.start_ts + s.rel_start, tz=UTC)
            end = datetime.fromtimestamp(utt.start_ts + s.rel_end, tz=UTC)
            sid = await self.db.ainsert(
                "INSERT INTO segments(channel_id,start,end,text,kind,final,language,confidence,stt_latency_ms) VALUES(?,?,?,?,?,1,?,?,?)",
                (utt.channel_id, iso(start), iso(end), s.text, s.kind, s.language, s.confidence, int(latency)),
            )
            self.bus.publish(
                {
                    "type": "transcript",
                    "id": sid,
                    "channel_id": utt.channel_id,
                    "start": iso(start),
                    "end": iso(end),
                    "text": s.text,
                    "kind": s.kind,
                    "final": True,
                    "language": s.language,
                    "confidence": s.confidence,
                    "speaker": None,
                    "recording_id": None,
                    "offset_s": None,
                    "demo": False,
                }
            )

    # ------------------------------------------------------------------ classifier worker
    async def _cls_loop(self) -> None:
        while True:
            channel_id, ts, window = await self.cls_q.get()
            try:
                t0 = time.monotonic()
                results = await asyncio.to_thread(self.classifier.classify, window)
                latency = (time.monotonic() - t0) * 1000
                self.cls_latency.add(latency)
                await self._handle_scores(channel_id, ts, results, latency)
            except Exception:
                log.exception("classifier failure")

    async def _handle_scores(self, channel_id: int, ts: float, results, latency: float) -> None:
        cfg = self.settings.get().thresholds
        best: dict[str, tuple[str, float]] = {}
        for label, cat, score in results:
            if cat is None:
                continue
            if cat not in best or score > best[cat][1]:
                best[cat] = (label, score)
        for cat, (label, score) in best.items():
            th = cfg.get(cat)
            if not th or not th.enabled or score < th.threshold:
                continue
            key = (channel_id, cat)
            if ts - self.last_fire.get(key, 0) < th.cooldown_s:
                continue  # duplicate suppression
            self.last_fire[key] = ts
            at = datetime.fromtimestamp(ts + 0.5, tz=UTC)
            ev = {
                "channel_id": channel_id,
                "at": iso(at),
                "category": cat,
                "label": label,
                "score": round(score, 3),
                "model": self.classifier.model_version,
                "status": "new",
                "note": None,
                "demo": False,
            }
            ev["id"] = await self.db.ainsert(
                "INSERT INTO events(channel_id,at,category,label,score,model,latency_ms) VALUES(?,?,?,?,?,?,?)",
                (channel_id, ev["at"], cat, label, ev["score"], ev["model"], int(latency)),
            )
            ev["clip_url"] = f"/api/v1/events/{ev['id']}/clip"
            ev["recording_id"] = None
            ev["offset_s"] = None
            self.bus.publish({"type": "event", **ev})
            self.on_event(ev)

    def status(self) -> dict:
        return {
            "stt_queue": self.stt_q.qsize(),
            "cls_queue": self.cls_q.qsize(),
            "stt_p50": self.stt_latency.pct(50),
            "cls_p50": self.cls_latency.pct(50),
            "stt_dropped": self.stt_dropped,
            "cls_dropped": self.cls_dropped,
        }

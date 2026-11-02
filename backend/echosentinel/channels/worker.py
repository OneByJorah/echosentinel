"""One supervised FFmpeg process per channel.

A single ffmpeg invocation decodes the RTSP audio once and fans out to:
  1. raw PCM s16le/16 kHz/mono on stdout  -> levels, VAD, STT, classifier, live listening
  2. (optional) time-aligned MP3 segments on disk -> recordings (crash-safe: MP3 needs no index)

Failures are reported with a classified reason; reconnects use exponential backoff + jitter.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from ..db import iso, utcnow
from ..security import redact_text
from .probe import PROTOCOL_WHITELIST, classify_error, probe, transport_args

log = logging.getLogger(__name__)

PCM_RATE = 16000
CHUNK_BYTES = 3200  # 100 ms of s16le mono @ 16 kHz


@dataclass
class WorkerConfig:
    channel_id: int
    slot: int
    url: str | None  # plaintext, server-side only
    transport: str = "tcp"
    record: bool = True
    input_args: list[str] | None = None  # override (demo/lavfi) — never user supplied
    segment_seconds: int = 3600


@dataclass
class WorkerStatus:
    state: str = "offline"
    reason: str | None = None
    codec: str | None = None
    sample_rate: int | None = None
    channels: int | None = None
    latency_ms: int | None = None
    last_packet_at: datetime | None = None
    last_seen_at: datetime | None = None
    online_since: datetime | None = None
    retry_at: datetime | None = None
    retry_attempt: int = 0
    recording: bool = False
    restarts: int = 0
    bytes_in: int = 0
    last_error: str | None = None
    ffmpeg_running: bool = False
    stderr_tail: deque = field(default_factory=lambda: deque(maxlen=20))


class ChannelWorker:
    def __init__(
        self,
        cfg: WorkerConfig,
        *,
        ffmpeg: str,
        ffprobe: str,
        rec_dir: Path,
        connect_timeout_s: float,
        backoff_base_s: float,
        backoff_max_s: float,
        on_pcm: Callable[[int, bytes, float], None],
        on_state: Callable[[int, WorkerStatus], None],
        record_allowed: Callable[[], bool],
        record_rate: int = 22050,
        record_bitrate: str = "48k",
    ):
        self.cfg = cfg
        self.ffmpeg, self.ffprobe = ffmpeg, ffprobe
        self.rec_dir = rec_dir
        self.connect_timeout_s = connect_timeout_s
        self.backoff_base_s, self.backoff_max_s = backoff_base_s, backoff_max_s
        self.on_pcm, self.on_state = on_pcm, on_state
        self.record_allowed = record_allowed
        self.record_rate, self.record_bitrate = record_rate, record_bitrate
        self.status = WorkerStatus()
        self._wake = asyncio.Event()
        self._stop = asyncio.Event()
        self._restart = asyncio.Event()
        self._proc: asyncio.subprocess.Process | None = None
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------------ public control
    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"channel-{self.cfg.slot}")

    async def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        await self._kill()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
        self._set(state="offline", reason="Stopped", recording=False, ffmpeg_running=False)

    def reconnect_now(self) -> None:
        self._wake.set()

    def restart_ffmpeg(self) -> None:
        """Restart the process (e.g. recording toggled by disk guard)."""
        self._restart.set()
        self._wake.set()
        if self._proc and self._proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self._proc.terminate()

    # ------------------------------------------------------------------ internals
    def _set(self, **kw) -> None:
        for k, v in kw.items():
            setattr(self.status, k, v)
        self.on_state(self.cfg.channel_id, self.status)

    def _backoff(self) -> float:
        n = self.status.retry_attempt
        delay = min(self.backoff_max_s, self.backoff_base_s * (2 ** min(n, 10)))
        return delay * random.uniform(0.6, 1.0)  # full-ish jitter

    async def _sleep_backoff(self) -> None:
        delay = self._backoff()
        self.status.retry_attempt += 1
        self._set(retry_at=datetime.fromtimestamp(time.time() + delay, tz=utcnow().tzinfo))
        self._wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), timeout=delay)
        self._set(retry_at=None)

    def _build_args(self, recording: bool) -> list[str]:
        c = self.cfg
        if c.input_args:
            inp = list(c.input_args)
        else:
            assert c.url
            inp = [
                "-protocol_whitelist",
                PROTOCOL_WHITELIST,
                *transport_args(c.transport),
                "-timeout",
                str(int(self.connect_timeout_s * 1_000_000)),
                "-fflags",
                "+genpts+discardcorrupt",
                "-i",
                c.url,
            ]
        args = [
            self.ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "warning",
            *inp,
            "-map",
            "0:a:0",
            "-af",
            "aresample=async=1000",
            "-ac",
            "1",
            "-ar",
            str(PCM_RATE),
            "-f",
            "s16le",
            "pipe:1",
        ]
        if recording:
            out_dir = self.rec_dir / f"ch{c.slot:02d}"
            out_dir.mkdir(parents=True, exist_ok=True)
            pattern = str(out_dir / f"ch{c.slot:02d}_%Y%m%dT%H%M%SZ.mp3")
            args += [
                "-map",
                "0:a:0",
                "-af",
                "aresample=async=1000",
                "-ac",
                "1",
                "-ar",
                str(self.record_rate),
                "-c:a",
                "libmp3lame",
                "-b:a",
                self.record_bitrate,
                "-f",
                "segment",
                "-segment_time",
                str(c.segment_seconds),
                "-segment_atclocktime",
                "1",
                "-strftime",
                "1",
                "-reset_timestamps",
                "1",
                "-segment_format_options",
                "flush_packets=1",
                "-flush_packets",
                "1",
                pattern,
            ]
        return args

    async def _kill(self) -> None:
        p = self._proc
        if p and p.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                p.terminate()
            try:
                await asyncio.wait_for(p.wait(), 5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    p.kill()
                await p.wait()

    async def _drain_stderr(self, stream: asyncio.StreamReader) -> None:
        while True:
            line = await stream.readline()
            if not line:
                return
            text = redact_text(line.decode(errors="replace").rstrip())
            if text:
                self.status.stderr_tail.append(text)

    async def _run(self) -> None:
        while not self._stop.is_set():
            if not self.cfg.input_args and not self.cfg.url:
                self._set(state="unconfigured", reason="No RTSP URL configured")
                return
            self._set(state="connecting", reason=None)
            if not self.cfg.input_args:
                pr = await probe(self.cfg.url or "", self.cfg.transport, self.ffprobe, self.connect_timeout_s)
                if not pr.ok:
                    state = "error" if pr.error and ("Authentication" in pr.error or "codec" in pr.error or "no audio" in pr.error) else "offline"
                    self._set(state=state, reason=pr.error, last_error=pr.error, latency_ms=pr.latency_ms)
                    await self._sleep_backoff()
                    continue
                self._set(codec=pr.codec, sample_rate=pr.sample_rate, channels=pr.channels, latency_ms=pr.latency_ms)
            else:
                self._set(codec="pcm (demo)", sample_rate=PCM_RATE, channels=1, latency_ms=0)

            await self._run_ffmpeg_once()
            if self._stop.is_set():
                return
            if self._restart.is_set():
                self._restart.clear()
                continue
            await self._sleep_backoff()

    async def _run_ffmpeg_once(self) -> None:
        recording = self.cfg.record and self.record_allowed()
        args = self._build_args(recording)
        try:
            self._proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={"TZ": "UTC", "PATH": "/usr/local/bin:/usr/bin:/bin"},
            )
        except FileNotFoundError:
            self._set(state="error", reason="ffmpeg not installed", last_error="ffmpeg not installed")
            return
        self.status.restarts += 1
        self._set(ffmpeg_running=True)
        assert self._proc.stdout and self._proc.stderr
        stderr_task = asyncio.create_task(self._drain_stderr(self._proc.stderr))
        got_data = False
        reason = None
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(self._proc.stdout.readexactly(CHUNK_BYTES), timeout=self.connect_timeout_s)
                except asyncio.IncompleteReadError:
                    reason = "Stream ended"
                    break
                except TimeoutError:
                    reason = "Stream stalled (no audio packets)"
                    break
                now = utcnow()
                if not got_data:
                    got_data = True
                    self.status.retry_attempt = 0
                    self._set(
                        state="online",
                        reason=None,
                        online_since=now,
                        recording=recording,
                        last_packet_at=now,
                        last_seen_at=now,
                    )
                self.status.last_packet_at = now
                self.status.last_seen_at = now
                self.status.bytes_in += len(chunk)
                self.on_pcm(self.cfg.channel_id, chunk, time.time())
        finally:
            await self._kill()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(stderr_task, 2)
            tail = "\n".join(self.status.stderr_tail)
            if not got_data and tail:
                reason = classify_error(tail)
            if self._restart.is_set():
                reason = "Restarting"
            self._set(
                state="offline",
                reason=reason,
                last_error=reason if reason != "Restarting" else self.status.last_error,
                online_since=None,
                recording=False,
                ffmpeg_running=False,
            )
            log.info("channel %s ffmpeg exited: %s", self.cfg.slot, reason)


def status_dict(s: WorkerStatus) -> dict:
    return {
        "state": s.state,
        "state_reason": s.reason,
        "codec": s.codec,
        "sample_rate": s.sample_rate,
        "channels": s.channels,
        "latency_ms": s.latency_ms,
        "last_packet_at": iso(s.last_packet_at),
        "last_seen_at": iso(s.last_seen_at),
        "online_since": iso(s.online_since),
        "retry_at": iso(s.retry_at),
        "retry_attempt": s.retry_attempt,
        "recording": s.recording,
    }

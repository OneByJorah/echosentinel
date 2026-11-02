"""ffprobe-based stream probing (codec, sample rate, connect latency)."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass

from ..security import redact_text

# ffmpeg/ffprobe may only speak these protocols; blocks file:, http:, concat: etc. smuggling.
PROTOCOL_WHITELIST = "rtsp,rtsps,rtp,srtp,tcp,udp,tls,crypto"


@dataclass
class ProbeResult:
    ok: bool
    codec: str | None = None
    sample_rate: int | None = None
    channels: int | None = None
    latency_ms: int | None = None
    error: str | None = None
    has_audio: bool = False


def transport_args(transport: str) -> list[str]:
    if transport in ("tcp", "udp"):
        return ["-rtsp_transport", transport]
    return []


def classify_error(stderr: str) -> str:
    s = stderr.lower()
    if "401" in s or "unauthorized" in s:
        return "Authentication failed (check credentials)"
    if "404" in s or "not found" in s:
        return "Stream path not found"
    if "connection refused" in s:
        return "Connection refused"
    if "timed out" in s or "timeout" in s:
        return "Connection timed out"
    if "no route to host" in s or "network is unreachable" in s:
        return "Host unreachable"
    if "invalid data" in s:
        return "Invalid stream data"
    if "decoder" in s and "not found" in s:
        return "Unsupported audio codec"
    lines = [ln for ln in stderr.strip().splitlines() if ln.strip()]
    return redact_text(lines[-1][:200]) if lines else "Unknown error"


async def probe(url: str, transport: str, ffprobe: str = "ffprobe", timeout_s: float = 10.0) -> ProbeResult:
    args = [
        ffprobe,
        "-v",
        "error",
        "-protocol_whitelist",
        PROTOCOL_WHITELIST,
        *transport_args(transport),
        "-timeout",
        str(int(timeout_s * 1_000_000)),
        "-show_streams",
        "-of",
        "json",
        url,
    ]
    t0 = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except FileNotFoundError:
        return ProbeResult(ok=False, error="ffprobe not installed")
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_s + 2)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        return ProbeResult(ok=False, error="Connection timed out")
    latency = int((time.monotonic() - t0) * 1000)
    if proc.returncode != 0:
        return ProbeResult(ok=False, error=classify_error(err.decode(errors="replace")), latency_ms=latency)
    try:
        streams = json.loads(out or b"{}").get("streams", [])
    except json.JSONDecodeError:
        return ProbeResult(ok=False, error="Unreadable probe output")
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    if not audio:
        return ProbeResult(ok=False, error="Stream has no audio track", latency_ms=latency)
    a = audio[0]
    sr = a.get("sample_rate")
    return ProbeResult(
        ok=True,
        has_audio=True,
        codec=a.get("codec_name"),
        sample_rate=int(sr) if sr else None,
        channels=a.get("channels"),
        latency_ms=latency,
    )

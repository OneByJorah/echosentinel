"""Recording index, waveform peaks, retention, disk guard, clips and timeline assembly.

Only files inside ES recordings root that match our own naming pattern are ever indexed or
deleted — unrelated NVR files are never touched.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import shutil
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .db import Database, iso, parse_iso, utcnow
from .serializers import event_out
from .settings_store import SettingsStore

log = logging.getLogger(__name__)

NAME_RE = re.compile(r"^ch(\d{2})_(\d{8}T\d{6}Z)\.mp3$")


def start_from_name(name: str) -> datetime | None:
    m = NAME_RE.match(name)
    if not m:
        return None
    return datetime.strptime(m.group(2), "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)


class Recorder:
    def __init__(
        self,
        db: Database,
        rec_dir: Path,
        settings: SettingsStore,
        ffmpeg: str,
        ffprobe: str,
        slot_to_channel: Callable[[int], int | None],
        is_recording: Callable[[int], bool],
        notify: Callable[[str, str, str], None],
        on_record_allowed_change: Callable[[bool], None],
    ):
        self.db, self.rec_dir, self.settings = db, rec_dir, settings
        self.ffmpeg, self.ffprobe = ffmpeg, ffprobe
        self.slot_to_channel = slot_to_channel
        self.is_recording = is_recording
        self.notify = notify
        self.on_record_allowed_change = on_record_allowed_change
        self.peaks: dict[int, dict[int, int]] = {}
        self.record_allowed = True
        self.state_detail: str | None = None
        self._tasks: list[asyncio.Task] = []
        rec_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self.check_disk()
        self._tasks = [
            asyncio.create_task(self._loop(self.index_once, 10), name="rec-index"),
            asyncio.create_task(self._loop(self.retention_once, 600), name="retention"),
            asyncio.create_task(self._loop(self._disk_tick, 15), name="disk-guard"),
        ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        with contextlib.suppress(Exception):
            await self.index_once(final=True)

    async def _loop(self, fn, interval: float) -> None:
        while True:
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("recorder task %s failed", getattr(fn, "__name__", fn))
            await asyncio.sleep(interval)

    # ------------------------------------------------------------------ peaks
    def add_peak(self, channel_id: int, sec: int, peak: int) -> None:
        ring = self.peaks.setdefault(channel_id, {})
        ring[sec] = peak
        if len(ring) > 4 * 3600:
            cutoff = sec - 3 * 3600
            for k in [k for k in ring if k < cutoff]:
                del ring[k]

    def _peaks_blob(self, channel_id: int, start: datetime, end: datetime) -> bytes | None:
        ring = self.peaks.get(channel_id)
        if not ring:
            return None
        s0, s1 = int(start.timestamp()), int(end.timestamp())
        if s1 <= s0:
            return None
        return bytes(ring.get(s, 0) for s in range(s0, s1))

    # ------------------------------------------------------------------ disk guard
    def disk_free(self) -> int:
        return shutil.disk_usage(self.rec_dir).free

    def check_disk(self) -> None:
        min_free = int(self.settings.get().min_free_gb * 1024**3)
        free = self.disk_free()
        allowed = free > min_free
        if allowed != self.record_allowed:
            self.record_allowed = allowed
            if not allowed:
                self.state_detail = "Recording paused: free disk below minimum"
                self.notify("error", "Recording paused", "Free disk space is below the configured minimum.")
            else:
                self.state_detail = None
                self.notify("info", "Recording resumed", "Free disk space recovered.")
            self.on_record_allowed_change(allowed)

    async def _disk_tick(self) -> None:
        self.check_disk()

    # ------------------------------------------------------------------ indexing
    async def _probe_duration(self, path: Path) -> float | None:
        try:
            proc = await asyncio.create_subprocess_exec(
                self.ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), 30)
            d = json.loads(out or b"{}").get("format", {}).get("duration")
            return float(d) if d else None
        except Exception:
            return None

    async def index_once(self, final: bool = False) -> None:
        """Reconcile the index with disk. Self-healing: any file whose size changed is re-examined,
        and the newest file counts as 'writing' while the worker records OR it was modified recently
        (avoids a startup race finalising a segment that is still growing)."""
        rows = {r["path"]: r for r in await self.db.aquery("SELECT id, path, status, bytes FROM recordings")}
        known = {p: r for p, r in rows.items() if r["status"] == "writing"}
        now_ts = time.time()
        for ch_dir in sorted(self.rec_dir.glob("ch[0-9][0-9]")):
            slot = int(ch_dir.name[2:])
            channel_id = self.slot_to_channel(slot)
            if channel_id is None:
                continue
            files = sorted(f for f in ch_dir.iterdir() if f.is_file() and NAME_RE.match(f.name))
            for i, f in enumerate(files):
                rel = str(f.relative_to(self.rec_dir))
                start = start_from_name(f.name)
                assert start
                st = f.stat()
                size = st.st_size
                newest = i == len(files) - 1
                recent = now_ts - st.st_mtime < 30
                still_writing = newest and not final and (self.is_recording(channel_id) or recent)
                known.pop(rel, None)
                row = rows.get(rel)
                if row is None:
                    rid = await self.db.ainsert(
                        "INSERT INTO recordings(channel_id,path,start,bytes,status) VALUES(?,?,?,?,?)",
                        (channel_id, rel, iso(start), size, "writing"),
                    )
                    row = {"id": rid, "status": "writing", "bytes": size}
                elif row["status"] != "writing" and row["bytes"] == size and not still_writing:
                    continue  # finalised and unchanged
                if still_writing:
                    blob = self._peaks_blob(channel_id, start, utcnow())
                    await self.db.aexecute(
                        "UPDATE recordings SET bytes=?, status='writing', end=NULL, duration_s=NULL, peaks=COALESCE(?, peaks) WHERE id=?",
                        (size, blob, row["id"]),
                    )
                else:
                    dur = await self._probe_duration(f)
                    status = "complete" if dur else "damaged"
                    end = start + timedelta(seconds=dur or 0)
                    blob = self._peaks_blob(channel_id, start, end)
                    await self.db.aexecute(
                        "UPDATE recordings SET bytes=?, status=?, duration_s=?, end=?, peaks=COALESCE(?, peaks) WHERE id=?",
                        (size, status, dur, iso(end), blob, row["id"]),
                    )
        # rows whose file vanished
        for rel, row in known.items():
            if not (self.rec_dir / rel).exists():
                await self.db.aexecute("UPDATE recordings SET status='damaged', end=COALESCE(end, start) WHERE id=?", (row["id"],))

    # ------------------------------------------------------------------ retention
    def _safe_path(self, rel: str) -> Path | None:
        p = (self.rec_dir / rel).resolve()
        if self.rec_dir not in p.parents or not NAME_RE.match(p.name):
            return None
        return p

    async def _delete_recording(self, row: dict) -> None:
        p = self._safe_path(row["path"])
        if p and p.exists():
            p.unlink()
        await self.db.aexecute("DELETE FROM recordings WHERE id=?", (row["id"],))

    async def retention_once(self) -> dict:
        s = self.settings.get()
        cutoff = utcnow() - timedelta(days=s.retention_days)
        deleted = 0
        for r in await self.db.aquery("SELECT id, path, bytes FROM recordings WHERE status!='writing' AND start < ?", (iso(cutoff),)):
            await self._delete_recording(r)
            deleted += 1
        quota = int(s.max_storage_gb * 1024**3)
        total = (await self.db.aone("SELECT COALESCE(SUM(bytes),0) AS b FROM recordings") or {"b": 0})["b"]
        if total > quota:
            for r in await self.db.aquery("SELECT id, path, bytes FROM recordings WHERE status!='writing' ORDER BY start LIMIT 1000"):
                if total <= quota:
                    break
                await self._delete_recording(r)
                total -= r["bytes"]
                deleted += 1
        tcut = iso(utcnow() - timedelta(days=s.transcript_retention_days))
        seg_del = await self.db.aexecute("DELETE FROM segments WHERE start < ?", (tcut,))
        ev_del = await self.db.aexecute("DELETE FROM events WHERE at < ? AND status != 'bookmarked'", (tcut,))
        if deleted or seg_del or ev_del:
            await self.db.ainsert(
                "INSERT INTO audit_log(at,username,action,target,detail) VALUES(?,?,?,?,?)",
                (iso(utcnow()), "system", "retention", "storage", json.dumps({"recordings": deleted, "segments": seg_del, "events": ev_del})),
            )
        return {"recordings": deleted, "segments": seg_del, "events": ev_del}

    # ------------------------------------------------------------------ lookup helpers
    async def locate(self, channel_id: int, at: datetime) -> tuple[int, float] | None:
        r = await self.db.aone(
            "SELECT id, start FROM recordings WHERE channel_id=? AND start<=? ORDER BY start DESC LIMIT 1",
            (channel_id, iso(at)),
        )
        if not r:
            return None
        rec = await self.db.aone("SELECT end, status FROM recordings WHERE id=?", (r["id"],))
        start = parse_iso(r["start"])
        assert start and rec
        end = parse_iso(rec["end"])
        if rec["status"] != "writing" and end and at > end:
            return None
        return r["id"], round((at - start).total_seconds(), 2)

    def file_for(self, rel: str) -> Path | None:
        return self._safe_path(rel)

    async def extract_clip(self, channel_id: int, start: datetime, end: datetime) -> bytes | None:
        rows = await self.db.aquery(
            "SELECT path, start, end, status FROM recordings WHERE channel_id=? AND start < ? "
            "AND (end IS NULL OR end > ?) AND status != 'damaged' ORDER BY start",
            (channel_id, iso(end), iso(start)),
        )
        if not rows:
            return None
        lines = []
        for r in rows:
            p = self._safe_path(r["path"])
            if not p or not p.exists():
                continue
            rs = parse_iso(r["start"])
            assert rs
            inpoint = max(0.0, (start - rs).total_seconds())
            outpoint = (end - rs).total_seconds()
            lines.append(f"file '{p.as_posix()}'\ninpoint {inpoint:.3f}\noutpoint {outpoint:.3f}\n")
        if not lines:
            return None
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as lf:
            lf.write("ffconcat version 1.0\n" + "".join(lines))
            list_path = lf.name
        try:
            proc = await asyncio.create_subprocess_exec(
                self.ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-f",
                "concat",
                "-safe",
                "0",
                "-protocol_whitelist",
                "file",
                "-i",
                list_path,
                "-c:a",
                "libmp3lame",
                "-b:a",
                "64k",
                "-f",
                "mp3",
                "pipe:1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            out, err = await asyncio.wait_for(proc.communicate(), 120)
            if proc.returncode != 0 or not out:
                log.warning("clip extraction failed: %s", err.decode(errors="replace")[-300:])
                return None
            return out
        finally:
            Path(list_path).unlink(missing_ok=True)

    # ------------------------------------------------------------------ timeline
    async def timeline(self, channel_id: int, start: datetime, end: datetime, buckets: int) -> dict:
        span = max(1.0, (end - start).total_seconds())
        bucket_s = span / buckets
        recs = await self.db.aquery(
            "SELECT id, start, end, status, peaks FROM recordings WHERE channel_id=? AND start < ? AND (end IS NULL OR end > ?) ORDER BY start",
            (channel_id, iso(end), iso(start)),
        )
        now = utcnow()
        coverage, peaks = [], [0.0] * buckets
        for r in recs:
            rs = parse_iso(r["start"])
            re_ = parse_iso(r["end"]) or now
            assert rs
            coverage.append({"start": iso(max(rs, start)), "end": iso(min(re_, end)), "recording_id": r["id"]})
            blob = r["peaks"]
            if blob:
                base = rs.timestamp()
                s0 = max(0, int(start.timestamp() - base))
                s1 = min(len(blob), int(end.timestamp() - base) + 1)
                for i in range(s0, s1):
                    b = int((base + i - start.timestamp()) / bucket_s)
                    if 0 <= b < buckets:
                        v = blob[i] / 255
                        if v > peaks[b]:
                            peaks[b] = v
        gaps = []
        cursor = start
        for c in coverage:
            cs, ce = parse_iso(c["start"]), parse_iso(c["end"])
            assert cs and ce
            if (cs - cursor).total_seconds() > 2:
                gaps.append({"start": iso(cursor), "end": iso(cs), "reason": "no recording"})
            cursor = max(cursor, ce)
        if (min(end, now) - cursor).total_seconds() > 2:
            gaps.append({"start": iso(cursor), "end": iso(min(end, now)), "reason": "no recording"})

        offline = []
        logs = await self.db.aquery("SELECT state, at FROM channel_status_log WHERE channel_id=? AND at < ? ORDER BY at", (channel_id, iso(end)))
        off_start: datetime | None = None
        for lg in logs:
            at = parse_iso(lg["at"])
            assert at
            if lg["state"] in ("offline", "error") and off_start is None:
                off_start = at
            elif lg["state"] == "online" and off_start is not None:
                if at > start:
                    offline.append({"start": iso(max(off_start, start)), "end": iso(at)})
                off_start = None
        if off_start is not None:
            offline.append({"start": iso(max(off_start, start)), "end": iso(min(end, now))})

        speech = [
            {"start": s["start"], "end": s["end"], "segment_id": s["id"]}
            for s in await self.db.aquery(
                "SELECT id, start, end FROM segments WHERE channel_id=? AND start>=? AND start<? AND kind!='noise' ORDER BY start LIMIT 5000",
                (channel_id, iso(start), iso(end)),
            )
        ]
        events = [
            event_out(e)
            for e in await self.db.aquery(
                "SELECT * FROM events WHERE channel_id=? AND at>=? AND at<? ORDER BY at LIMIT 2000",
                (channel_id, iso(start), iso(end)),
            )
        ]
        return {
            "start": iso(start),
            "end": iso(end),
            "bucket_s": round(bucket_s, 3),
            "coverage": coverage,
            "gaps": gaps,
            "offline": offline,
            "speech": speech,
            "events": events,
            "peaks": [round(p, 3) for p in peaks],
        }

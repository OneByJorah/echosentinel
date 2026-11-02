"""Transcripts, events, recordings, timeline, exports, analytics."""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from ..db import iso, parse_iso, utcnow
from ..serializers import event_out, recording_out, segment_out
from .deps import audit, client_ip, engine, require

router = APIRouter()


def _dt(s: str | None, name: str) -> datetime | None:
    if s is None:
        return None
    try:
        return parse_iso(s)
    except ValueError:
        raise HTTPException(422, f"Invalid {name} timestamp") from None


def fts_query(q: str) -> str | None:
    words = re.findall(r"[\w'-]+", q, flags=re.UNICODE)[:12]
    if not words:
        return None
    return " ".join('"' + w.replace('"', "") + '"' for w in words)


# ---------------------------------------------------------------------------- transcripts
def _segment_filters(q, channel_id, start, end, kind):
    where, params = [], []
    if q:
        fq = fts_query(q)
        if fq:
            where.append("id IN (SELECT rowid FROM segments_fts WHERE segments_fts MATCH ?)")
            params.append(fq)
    if channel_id:
        where.append("channel_id=?")
        params.append(channel_id)
    if start:
        where.append("start>=?")
        params.append(iso(_dt(start, "start")))
    if end:
        where.append("start<?")
        params.append(iso(_dt(end, "end")))
    if kind:
        where.append("kind=?")
        params.append(kind)
    return where, params


@router.get("/transcripts")
async def transcripts(
    request: Request,
    q: str | None = None,
    channel_id: int | None = None,
    start: str | None = None,
    end: str | None = None,
    kind: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    before_id: int | None = None,
    user=Depends(require("viewer")),
):
    e = engine(request)
    where, params = _segment_filters(q, channel_id, start, end, kind)
    if before_id:
        where.append("id<?")
        params.append(before_id)
    sql = "SELECT * FROM segments" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id DESC LIMIT ?"  # noqa: S608 (fixed column names, bound params)
    rows = await e.db.aquery(sql, (*params, limit))
    items = []
    for r in rows:
        loc = await e.recorder.locate(r["channel_id"], parse_iso(r["start"]))  # type: ignore[arg-type]
        items.append(segment_out(r, loc))
    return {"items": items, "next_before_id": rows[-1]["id"] if len(rows) == limit else None}


def _csv_safe(v) -> str:
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


@router.get("/transcripts/export")
async def export_transcripts(
    request: Request,
    format: Literal["txt", "json", "csv"] = "txt",
    q: str | None = None,
    channel_id: int | None = None,
    start: str | None = None,
    end: str | None = None,
    kind: str | None = None,
    user=Depends(require("operator")),
):
    e = engine(request)
    where, params = _segment_filters(q, channel_id, start, end, kind)
    sql = "SELECT * FROM segments" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY start LIMIT 50000"  # noqa: S608 (fixed column names, bound params)
    rows = await e.db.aquery(sql, tuple(params))
    names = {cid: r["name"] for cid, r in e.channels.items()}
    audit(e, user, "transcript_export", format, client_ip(request), {"count": len(rows)})
    stamp = utcnow().strftime("%Y%m%dT%H%M%SZ")
    if format == "json":
        body = json.dumps([segment_out(r) | {"channel_name": names.get(r["channel_id"])} for r in rows], indent=2)
        media = "application/json"
    elif format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "channel_id", "channel_name", "start", "end", "kind", "language", "confidence", "text"])
        for r in rows:
            w.writerow(
                [
                    _csv_safe(x)
                    for x in (
                        r["id"],
                        r["channel_id"],
                        names.get(r["channel_id"]),
                        r["start"],
                        r["end"],
                        r["kind"],
                        r["language"],
                        r["confidence"],
                        r["text"],
                    )
                ]
            )
        body, media = buf.getvalue(), "text/csv"
    else:
        lines = [
            f"[{r['start']}] CH{r['channel_id']:02d} {names.get(r['channel_id'], '')} ({r['kind']}"
            + (f", conf {r['confidence']:.2f}" if r["confidence"] is not None else "")
            + f"): {r['text']}"
            for r in rows
        ]
        body = "EchoSentinel transcript export — machine transcription, may contain errors.\n\n" + "\n".join(lines)
        media = "text/plain"
    return Response(
        body,
        media_type=media + "; charset=utf-8",
        headers={"content-disposition": f'attachment; filename="echosentinel-transcripts-{stamp}.{format}"'},
    )


class DeleteRange(BaseModel):
    start: str
    end: str
    channel_id: int | None = None


@router.delete("/transcripts")
async def delete_transcripts(body: DeleteRange, request: Request, user=Depends(require("admin"))):
    e = engine(request)
    params: list = [iso(_dt(body.start, "start")), iso(_dt(body.end, "end"))]
    sql = "DELETE FROM segments WHERE start>=? AND start<?"
    if body.channel_id:
        sql += " AND channel_id=?"
        params.append(body.channel_id)
    n = await e.db.aexecute(sql, tuple(params))
    audit(e, user, "transcript_delete", None, client_ip(request), {**body.model_dump(), "deleted": n})
    return {"deleted": n}


# ---------------------------------------------------------------------------- events
@router.get("/events")
async def events(
    request: Request,
    category: str | None = None,
    channel_id: int | None = None,
    status: str | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    before_id: int | None = None,
    user=Depends(require("viewer")),
):
    e = engine(request)
    where, params = [], []
    for col, val in (("category", category), ("channel_id", channel_id), ("status", status)):
        if val is not None:
            where.append(f"{col}=?")
            params.append(val)
    if start:
        where.append("at>=?")
        params.append(iso(_dt(start, "start")))
    if end:
        where.append("at<?")
        params.append(iso(_dt(end, "end")))
    if before_id:
        where.append("id<?")
        params.append(before_id)
    sql = "SELECT * FROM events" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id DESC LIMIT ?"  # noqa: S608 (fixed column names, bound params)
    rows = await e.db.aquery(sql, (*params, limit))
    items = []
    for r in rows:
        loc = await e.recorder.locate(r["channel_id"], parse_iso(r["at"]))  # type: ignore[arg-type]
        items.append(event_out(r, loc))
    return {"items": items, "next_before_id": rows[-1]["id"] if len(rows) == limit else None}


@router.get("/events/stats")
async def event_stats(request: Request, user=Depends(require("viewer"))):
    e = engine(request)
    unrev = await e.db.aone("SELECT COUNT(*) AS n FROM events WHERE status='new'")
    today = iso(e.today_start())
    by = await e.db.aquery("SELECT category, COUNT(*) AS n FROM events WHERE at>=? GROUP BY category", (today,))
    return {"unreviewed": unrev["n"] if unrev else 0, "today": sum(r["n"] for r in by), "by_category": {r["category"]: r["n"] for r in by}}


class EventPatch(BaseModel):
    status: Literal["new", "acknowledged", "dismissed", "bookmarked"] | None = None
    note: str | None = Field(None, max_length=2000)


@router.patch("/events/{eid}")
async def patch_event(eid: int, body: EventPatch, request: Request, user=Depends(require("operator"))):
    e = engine(request)
    row = await e.db.aone("SELECT * FROM events WHERE id=?", (eid,))
    if not row:
        raise HTTPException(404, "Event not found")
    if body.status is not None:
        await e.db.aexecute("UPDATE events SET status=? WHERE id=?", (body.status, eid))
    if body.note is not None:
        await e.db.aexecute("UPDATE events SET note=? WHERE id=?", (body.note, eid))
    audit(e, user, "event_review", f"event:{eid}", client_ip(request), body.model_dump(exclude_none=True))
    row = await e.db.aone("SELECT * FROM events WHERE id=?", (eid,))
    loc = await e.recorder.locate(row["channel_id"], parse_iso(row["at"]))  # type: ignore[index,arg-type]
    out = event_out(row, loc)  # type: ignore[arg-type]
    e.bus.publish({"type": "event", **out})
    return out


@router.get("/events/{eid}/clip")
async def event_clip(eid: int, request: Request, user=Depends(require("operator"))):
    e = engine(request)
    row = await e.db.aone("SELECT * FROM events WHERE id=?", (eid,))
    if not row:
        raise HTTPException(404, "Event not found")
    at = parse_iso(row["at"])
    assert at
    data = await e.recorder.extract_clip(row["channel_id"], at - timedelta(seconds=5), at + timedelta(seconds=5))
    if not data:
        raise HTTPException(404, "No recording covers this event")
    audit(e, user, "clip_play", f"event:{eid}", client_ip(request))
    return Response(data, media_type="audio/mpeg", headers={"cache-control": "private, max-age=300"})


# ---------------------------------------------------------------------------- recordings
@router.get("/recordings")
async def recordings(
    request: Request,
    channel_id: int | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = Query(200, ge=1, le=2000),
    user=Depends(require("viewer")),
):
    e = engine(request)
    where, params = [], []
    if channel_id:
        where.append("channel_id=?")
        params.append(channel_id)
    if start:
        where.append("(end IS NULL OR end>?)")
        params.append(iso(_dt(start, "start")))
    if end:
        where.append("start<?")
        params.append(iso(_dt(end, "end")))
    sql = (
        "SELECT id,channel_id,start,end,duration_s,bytes,status FROM recordings"  # noqa: S608 (fixed column names, bound params)
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY start DESC LIMIT ?"
    )
    return [recording_out(r) for r in await e.db.aquery(sql, (*params, limit))]


_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


@router.get("/recordings/{rid}/audio")
async def recording_audio(rid: int, request: Request, user=Depends(require("viewer"))):
    e = engine(request)
    row = await e.db.aone("SELECT path FROM recordings WHERE id=?", (rid,))
    if not row:
        raise HTTPException(404, "Recording not found")
    path = e.recorder.file_for(row["path"])
    if not path or not path.exists():
        raise HTTPException(404, "Recording file missing")
    size = path.stat().st_size
    start, end = 0, size - 1
    status = 200
    rng = request.headers.get("range")
    if rng:
        m = _RANGE.match(rng.strip())
        if not m or (not m.group(1) and not m.group(2)):
            raise HTTPException(416, "Bad range")
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start = max(0, size - int(m.group(2)))
        end = min(end, size - 1)
        if start > end:
            return Response(status_code=416, headers={"content-range": f"bytes */{size}"})
        status = 206

    def gen():
        with path.open("rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    headers = {"accept-ranges": "bytes", "content-length": str(end - start + 1), "cache-control": "private"}
    if status == 206:
        headers["content-range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(gen(), status_code=status, media_type="audio/mpeg", headers=headers)


@router.get("/timeline")
async def timeline(
    request: Request,
    channel_id: int,
    start: str | None = None,
    end: str | None = None,
    buckets: int = Query(300, ge=10, le=2000),
    user=Depends(require("viewer")),
):
    e = engine(request)
    if channel_id not in e.channels:
        raise HTTPException(404, "Channel not found")
    t_end = _dt(end, "end") or utcnow()
    t_start = _dt(start, "start") or (t_end - timedelta(minutes=5))
    if t_end <= t_start or (t_end - t_start) > timedelta(days=2):
        raise HTTPException(422, "Range must be positive and at most 48 h")
    return await e.recorder.timeline(channel_id, t_start, t_end, buckets)


class ClipIn(BaseModel):
    channel_id: int
    start: str
    end: str


@router.post("/exports/clip")
async def export_clip(body: ClipIn, request: Request, user=Depends(require("operator"))):
    e = engine(request)
    s, en = _dt(body.start, "start"), _dt(body.end, "end")
    assert s and en
    if en <= s or (en - s) > timedelta(minutes=15):
        raise HTTPException(422, "Clip must be between 0 and 15 minutes")
    if body.channel_id not in e.channels:
        raise HTTPException(404, "Channel not found")
    data = await e.recorder.extract_clip(body.channel_id, s, en)
    if not data:
        raise HTTPException(404, "No recorded audio in that range")
    meta = {
        "channel_id": body.channel_id,
        "channel_name": e.channels[body.channel_id]["name"],
        "start": iso(s),
        "end": iso(en),
        "exported_at": iso(utcnow()),
        "exported_by": user["username"],
    }
    audit(e, user, "clip_export", f"channel:{body.channel_id}", client_ip(request), meta)
    fname = f"echosentinel-ch{e.channels[body.channel_id]['slot']:02d}-{s.strftime('%Y%m%dT%H%M%SZ')}.mp3"
    return Response(
        data,
        media_type="audio/mpeg",
        headers={
            "content-disposition": f'attachment; filename="{fname}"',
            "x-echosentinel-meta": json.dumps(meta),
            "access-control-expose-headers": "x-echosentinel-meta",
        },
    )


# ---------------------------------------------------------------------------- analytics
def _pcts(vals: list[int]) -> dict | None:
    if not vals:
        return None
    vals = sorted(vals)
    return {"p50": vals[len(vals) // 2], "p95": vals[min(len(vals) - 1, int(len(vals) * 0.95))]}


@router.get("/analytics")
async def analytics(request: Request, range: Literal["24h", "7d", "30d"] = "24h", user=Depends(require("viewer"))):
    e = engine(request)
    start, end = e.window(range)
    span = (end - start).total_seconds()
    uptime = []
    for cid in sorted(e.channels):
        prev = await e.db.aone("SELECT state FROM channel_status_log WHERE channel_id=? AND at<? ORDER BY at DESC LIMIT 1", (cid, iso(start)))
        logs = await e.db.aquery("SELECT state, at FROM channel_status_log WHERE channel_id=? AND at>=? ORDER BY at", (cid, iso(start)))
        state, cursor, online_s, outages = (prev or {}).get("state"), start, 0.0, 0
        for lg in logs:
            at = parse_iso(lg["at"])
            assert at
            if state == "online":
                online_s += (at - cursor).total_seconds()
                if lg["state"] in ("offline", "error"):
                    outages += 1
            state, cursor = lg["state"], at
        if state == "online":
            online_s += (end - cursor).total_seconds()
        uptime.append({"channel_id": cid, "uptime_pct": round(100 * online_s / span, 2), "outages": outages})
    by_cat = await e.db.aquery("SELECT category, COUNT(*) AS n FROM events WHERE at>=? GROUP BY category", (iso(start),))
    bucket = "%Y-%m-%dT%H:00:00Z" if range == "24h" else "%Y-%m-%dT00:00:00Z"
    by_hour = await e.db.aquery(
        f"SELECT strftime('{bucket}', at) AS hour, COUNT(*) AS n FROM events WHERE at>=? GROUP BY hour ORDER BY hour",  # noqa: S608
        (iso(start),),
    )
    speech = await e.db.aquery(
        "SELECT channel_id, SUM((julianday(end)-julianday(start))*1440.0) AS m FROM segments WHERE start>=? AND kind='speech' GROUP BY channel_id",
        (iso(start),),
    )
    cov = {}
    for cid in sorted(e.channels):
        recs = await e.db.aquery("SELECT start, end FROM recordings WHERE channel_id=? AND (end IS NULL OR end>?)", (cid, iso(start)))
        secs = 0.0
        for r in recs:
            rs, re_ = parse_iso(r["start"]), parse_iso(r["end"]) or end
            assert rs
            secs += max(0.0, (min(re_, end) - max(rs, start)).total_seconds())
        cov[str(cid)] = round(min(100.0, 100 * secs / span), 2)
    stt = [
        r["v"] for r in await e.db.aquery("SELECT stt_latency_ms AS v FROM segments WHERE start>=? AND stt_latency_ms>0 AND demo=0", (iso(start),))
    ]
    cls = [r["v"] for r in await e.db.aquery("SELECT latency_ms AS v FROM events WHERE at>=? AND latency_ms>0 AND demo=0", (iso(start),))]
    errors = await e.db.aone("SELECT COUNT(*) AS n FROM channel_status_log WHERE at>=? AND state='error'", (iso(start),))
    return {
        "range": range,
        "uptime": uptime,
        "events_by_category": {r["category"]: r["n"] for r in by_cat},
        "events_by_hour": [{"hour": r["hour"], "count": r["n"]} for r in by_hour],
        "speech_minutes_by_channel": {str(r["channel_id"]): round(r["m"] or 0, 2) for r in speech},
        "recording_coverage_pct": cov,
        "stt_latency_ms": _pcts(stt),
        "classifier_latency_ms": _pcts(cls),
        "error_count": errors["n"] if errors else 0,
    }

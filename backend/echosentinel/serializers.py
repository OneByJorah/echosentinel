"""Row -> API shape helpers (single source of truth for wire formats)."""

from __future__ import annotations

from typing import Any


def event_out(r: dict[str, Any], recording: tuple[int, float] | None = None) -> dict[str, Any]:
    return {
        "id": r["id"],
        "channel_id": r["channel_id"],
        "at": r["at"],
        "category": r["category"],
        "label": r["label"],
        "score": r["score"],
        "model": r["model"],
        "status": r["status"],
        "note": r["note"],
        "demo": bool(r.get("demo")),
        "recording_id": recording[0] if recording else None,
        "offset_s": recording[1] if recording else None,
        "clip_url": f"/api/v1/events/{r['id']}/clip",
    }


def segment_out(r: dict[str, Any], recording: tuple[int, float] | None = None) -> dict[str, Any]:
    return {
        "id": r["id"],
        "channel_id": r["channel_id"],
        "start": r["start"],
        "end": r["end"],
        "text": r["text"],
        "kind": r["kind"],
        "final": bool(r["final"]),
        "language": r["language"],
        "confidence": r["confidence"],
        "speaker": r["speaker"],
        "demo": bool(r.get("demo")),
        "recording_id": recording[0] if recording else None,
        "offset_s": recording[1] if recording else None,
    }


def recording_out(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "channel_id": r["channel_id"],
        "start": r["start"],
        "end": r["end"],
        "duration_s": r["duration_s"],
        "bytes": r["bytes"],
        "status": r["status"],
        "url": f"/api/v1/recordings/{r['id']}/audio",
    }


def user_out(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "username": r["username"],
        "role": r["role"],
        "disabled": bool(r.get("disabled")),
        "created_at": r["created_at"],
        "last_login_at": r.get("last_login_at"),
    }

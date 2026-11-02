"""DEMO MODE ONLY — synthetic transcripts and detections, flagged demo=1, stored in demo.db.

Channel audio in demo mode is a real FFmpeg-decoded synthetic signal (lavfi), so levels,
recording, timeline and playback exercise the genuine pipeline. Text and detections below are
canned and are never written when demo mode is off.
"""

from __future__ import annotations

import asyncio
import random
from datetime import timedelta

from .db import iso, utcnow

LINES = [
    "[DEMO] Package delivery at the front door.",
    "[DEMO] Can you check if the gate is locked?",
    "[DEMO] I'll be back in about twenty minutes.",
    "[DEMO] Someone is ringing the bell.",
    "[DEMO] The car is parked out front.",
]
EVENTS = [
    ("barking", "Dog"),
    ("vehicle", "Car passing by"),
    ("knock", "Knock"),
    ("alarm_siren", "Siren"),
    ("speech", "Speech"),
]


class DemoGenerator:
    def __init__(self, engine):
        self.e = engine

    async def run(self) -> None:
        await asyncio.sleep(3)
        while True:
            ch = min(self.e.channels, key=lambda c: self.e.channels[c]["slot"])
            if self.e.workers.get(ch) and self.e.workers[ch].status.state == "online":
                if random.random() < 0.6:
                    await self._segment(ch)
                else:
                    await self._event(ch)
            await asyncio.sleep(random.uniform(6, 12))

    async def _segment(self, ch: int) -> None:
        end = utcnow()
        start = end - timedelta(seconds=random.uniform(1.5, 3.5))
        noise = random.random() < 0.2
        text = "[DEMO] (noise)" if noise else random.choice(LINES)
        kind = "noise" if noise else "speech"
        conf = None if noise else round(random.uniform(0.6, 0.95), 2)
        sid = await self.e.db.ainsert(
            "INSERT INTO segments(channel_id,start,end,text,kind,final,language,confidence,demo,stt_latency_ms) VALUES(?,?,?,?,?,1,'en',?,1,0)",
            (ch, iso(start), iso(end), text, kind, conf),
        )
        loc = await self.e.recorder.locate(ch, start)
        self.e.bus.publish(
            {
                "type": "transcript",
                "id": sid,
                "channel_id": ch,
                "start": iso(start),
                "end": iso(end),
                "text": text,
                "kind": kind,
                "final": True,
                "language": "en",
                "confidence": conf,
                "speaker": None,
                "recording_id": loc[0] if loc else None,
                "offset_s": loc[1] if loc else None,
                "demo": True,
            }
        )

    async def _event(self, ch: int) -> None:
        th = self.e.settings.get().thresholds
        choices = [(c, lab) for c, lab in EVENTS if th.get(c) and th[c].enabled]
        if not choices:
            return
        cat, label = random.choice(choices)
        at = utcnow()
        score = round(random.uniform(0.55, 0.9), 2)
        eid = await self.e.db.ainsert(
            "INSERT INTO events(channel_id,at,category,label,score,model,demo,latency_ms) VALUES(?,?,?,?,?,?,1,0)",
            (ch, iso(at), cat, label, score, "demo-synthetic"),
        )
        loc = await self.e.recorder.locate(ch, at)
        ev = {
            "id": eid,
            "channel_id": ch,
            "at": iso(at),
            "category": cat,
            "label": label,
            "score": score,
            "model": "demo-synthetic",
            "status": "new",
            "note": None,
            "demo": True,
            "recording_id": loc[0] if loc else None,
            "offset_s": loc[1] if loc else None,
            "clip_url": f"/api/v1/events/{eid}/clip",
        }
        self.e.bus.publish({"type": "event", **ev})
        self.e.events_today[ch] = self.e.events_today.get(ch, 0) + 1
        self.e.schedule_snapshot()

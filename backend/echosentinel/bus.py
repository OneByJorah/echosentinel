"""In-process pub/sub hub feeding WebSocket clients. Slow consumers drop messages, never block."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

log = logging.getLogger(__name__)


class Subscriber:
    def __init__(self, maxsize: int = 512):
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=maxsize)
        self.dropped = 0


class Bus:
    def __init__(self) -> None:
        self._subs: set[Subscriber] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self) -> Subscriber:
        s = Subscriber()
        self._subs.add(s)
        return s

    def unsubscribe(self, s: Subscriber) -> None:
        self._subs.discard(s)

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)

    def publish(self, msg: dict[str, Any]) -> None:
        for s in list(self._subs):
            try:
                s.queue.put_nowait(msg)
            except asyncio.QueueFull:
                # Drop the oldest so live views stay current.
                try:
                    s.queue.get_nowait()
                    s.queue.put_nowait(msg)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
                s.dropped += 1

    def publish_threadsafe(self, msg: dict[str, Any]) -> None:
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self.publish, msg)


class AudioFanout:
    """Per-channel raw PCM fan-out for authenticated live listeners."""

    def __init__(self) -> None:
        self._listeners: dict[int, set[asyncio.Queue[bytes]]] = {}

    def add(self, channel_id: int) -> asyncio.Queue[bytes]:
        q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=50)
        self._listeners.setdefault(channel_id, set()).add(q)
        return q

    def remove(self, channel_id: int, q: asyncio.Queue[bytes]) -> None:
        self._listeners.get(channel_id, set()).discard(q)

    def has_listeners(self, channel_id: int) -> bool:
        return bool(self._listeners.get(channel_id))

    def push(self, channel_id: int, pcm: bytes) -> None:
        for q in list(self._listeners.get(channel_id, ())):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(pcm)

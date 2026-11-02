from __future__ import annotations

import asyncio
import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import __version__
from .deps import ROLE_RANK, audit, client_ip, ws_user

router = APIRouter()


@router.websocket("/ws/live")
async def live(ws: WebSocket):
    user = ws_user(ws)
    if not user:
        await ws.close(code=4401)
        return
    e = ws.app.state.engine
    await ws.accept()
    sub = e.bus.subscribe()
    try:
        await ws.send_json({"type": "hello", "version": __version__, "demo_mode": e.cfg.demo_mode})
        await ws.send_json({"type": "channels", "channels": e.channel_views()})
        await ws.send_json({"type": "pipeline", **e.pipeline_status()})
        if e.metrics:
            await ws.send_json({"type": "metrics", **e.metrics})

        async def reader():
            while True:
                msg = await ws.receive_text()
                with contextlib.suppress(Exception):
                    if json.loads(msg).get("type") == "ping":
                        await ws.send_json({"type": "pong"})

        rtask = asyncio.create_task(reader())
        try:
            while not rtask.done():
                try:
                    msg = await asyncio.wait_for(sub.queue.get(), timeout=20)
                except TimeoutError:
                    msg = {"type": "keepalive"}
                await ws.send_json(msg)
        finally:
            rtask.cancel()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        e.bus.unsubscribe(sub)


@router.websocket("/ws/audio/{channel_id}")
async def audio(ws: WebSocket, channel_id: int):
    user = ws_user(ws)
    if not user or ROLE_RANK[user["role"]] < ROLE_RANK["viewer"]:
        await ws.close(code=4401)
        return
    e = ws.app.state.engine
    w = e.workers.get(channel_id)
    await ws.accept()
    if not w or w.status.state != "online":
        await ws.close(code=4404)
        return
    audit(e, user, "listen_start", f"channel:{channel_id}", client_ip(ws))
    q = e.fanout.add(channel_id)
    try:
        await ws.send_text(json.dumps({"format": "s16le", "sample_rate": 16000, "channels": 1}))
        while True:
            try:
                pcm = await asyncio.wait_for(q.get(), timeout=15)
            except TimeoutError:
                await ws.close(code=4404)
                return
            await ws.send_bytes(pcm)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        e.fanout.remove(channel_id, q)
        audit(e, user, "listen_stop", f"channel:{channel_id}", client_ip(ws))

"""End-to-end against a REAL RTSP server (mediamtx + ffmpeg publisher).

Run with:  ES_TEST_RTSP_URL=rtsp://cam:s3cretPass@127.0.0.1:8554/ch1 pytest tests/test_integration_rtsp.py
See scripts/test-rtsp-env.sh to spin the server up. Skipped when the variable is unset.
"""

from __future__ import annotations

import time
from urllib.parse import urlsplit, urlunsplit

import pytest
from conftest import RTSP_URL, login

pytestmark = pytest.mark.skipif(not RTSP_URL, reason="ES_TEST_RTSP_URL not set (no live RTSP server)")


def wait_for(fn, timeout=30.0, interval=0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    return last


def test_one_online_three_offline_real_stream(client):
    h = login(client)
    p = urlsplit(RTSP_URL)
    bad_auth = urlunsplit((p.scheme, f"cam:wrongpass@{p.hostname}:{p.port}", p.path, "", ""))
    missing = urlunsplit((p.scheme, f"{p.hostname}:{p.port}", "/does-not-exist", "", ""))
    refused = f"rtsp://{p.hostname}:1/nothing"
    for cid, url in ((1, RTSP_URL), (2, bad_auth), (3, missing), (4, refused)):
        r = client.put(f"/api/v1/channels/{cid}", json={"url": url, "name": f"Test {cid}"}, headers=h)
        assert r.status_code == 200, r.text

    def states():
        c = {x["id"]: x for x in client.get("/api/v1/channels").json()}
        return c if c[1]["state"] == "online" and all(c[i]["state"] in ("offline", "error") for i in (2, 3, 4)) else None

    chans = wait_for(states, 40)
    assert chans, client.get("/api/v1/channels").json()
    assert chans[1]["codec"] == "aac" and chans[1]["sample_rate"] == 16000 and chans[1]["recording"]
    assert chans[2]["state"] == "error" and "Authentication" in chans[2]["state_reason"]
    assert chans[4]["state_reason"] in ("Connection refused", "Connection timed out")
    assert chans[4]["retry_at"] or chans[4]["state"] == "connecting"
    assert "s3cretPass" not in client.get("/api/v1/channels").text

    # Real levels over the live WebSocket (test signal is gated 2 s on / 2 s off, so sample ~5 s)
    with client.websocket_connect("/ws/live") as ws:
        peaks: list[float] = []
        deadline = time.time() + 8
        while time.time() < deadline and len(peaks) < 250:
            m = ws.receive_json()
            if m["type"] == "levels" and m["channel_id"] == 1:
                assert len(m["peaks"]) == 5
                peaks += m["peaks"]
        assert peaks and max(peaks) > 0.2 and min(peaks) < 0.05  # tone bursts and the quiet noise floor both seen

    # Live listening delivers real PCM
    with client.websocket_connect("/ws/audio/1") as ws:
        hdr = ws.receive_text()
        assert "s16le" in hdr
        assert len(ws.receive_bytes()) == 3200

    # Offline channel listening is refused
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/audio/4") as ws:
            ws.receive_text()

    # Recording gets indexed and is playable with Range
    e = client.app.state.engine

    def rec():
        import asyncio

        asyncio.run_coroutine_threadsafe(e.recorder.index_once(), e.bus.loop).result(10)
        rs = client.get("/api/v1/recordings", params={"channel_id": 1}).json()
        return rs if rs and rs[0]["bytes"] > 20000 else None

    recs = wait_for(rec, 30, 2)
    assert recs and recs[0]["status"] == "writing"
    r = client.get(recs[0]["url"], headers={"range": "bytes=0-1023"})
    assert r.status_code == 206 and len(r.content) == 1024

    # Timeline has coverage + real peaks, clip export works
    tl = client.get("/api/v1/timeline", params={"channel_id": 1, "buckets": 60}).json()
    assert tl["coverage"] and max(tl["peaks"]) > 0
    start = recs[0]["start"]
    from datetime import timedelta

    from echosentinel.db import iso, parse_iso

    s = parse_iso(start) + timedelta(seconds=1)
    clip = client.post("/api/v1/exports/clip", json={"channel_id": 1, "start": iso(s), "end": iso(s + timedelta(seconds=3))}, headers=h)
    assert clip.status_code == 200 and clip.content[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3") and "x-echosentinel-meta" in clip.headers

    # Manual reconnect on an offline channel and diagnostics
    assert client.post("/api/v1/channels/4/reconnect", headers=h).status_code == 200
    d = client.get("/api/v1/channels/2/diagnostics").json()
    assert d["status_log"] and "wrongpass" not in str(d)

    # Connection test endpoint
    t = client.post("/api/v1/channels/test", json={"channel_id": 1}, headers=h).json()
    assert t["ok"] and t["codec"] == "aac"

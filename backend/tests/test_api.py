from __future__ import annotations

from conftest import PASSWORD, login


def test_meta_and_health(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    m = client.get("/api/v1/meta").json()
    assert m["name"] == "EchoSentinel" and m["demo_mode"] is False and m["setup_required"] is False


def test_security_headers(client):
    h = client.get("/api/v1/meta").headers
    assert "frame-ancestors 'none'" in h["content-security-policy"]
    assert h["x-content-type-options"] == "nosniff"


def test_requires_auth(client):
    for path in ("/api/v1/channels", "/api/v1/transcripts", "/api/v1/events", "/api/v1/system/metrics"):
        assert client.get(path).status_code == 401


def test_login_bad_password_and_rate_limit(client):
    for _ in range(8):
        assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": "admin", "password": PASSWORD}).status_code == 429


def test_csrf_required(client):
    login(client)
    r = client.put("/api/v1/channels/1", json={"name": "Front"})
    assert r.status_code == 403 and "CSRF" in r.text


def test_four_channels_unconfigured(client):
    login(client)
    chans = client.get("/api/v1/channels").json()
    assert [c["slot"] for c in chans] == [1, 2, 3, 4]
    assert all(c["state"] == "unconfigured" for c in chans)


def test_rbac(client):
    h = login(client, "viewer")
    assert client.get("/api/v1/channels").status_code == 200
    assert client.put("/api/v1/channels/1", json={"name": "x"}, headers=h).status_code == 403
    assert client.post("/api/v1/channels/1/reconnect", headers=h).status_code == 403
    assert client.get("/api/v1/users").status_code == 403
    h = login(client, "op")
    assert client.post("/api/v1/channels/1/reconnect", headers=h).status_code == 200
    assert client.get("/api/v1/system/audit").status_code == 403


def test_channel_url_never_leaks(client):
    h = login(client)
    r = client.put("/api/v1/channels/2", json={"name": "Garage", "url": "rtsp://cam:TopSecret99@127.0.0.1:1/x"}, headers=h)
    assert r.status_code == 200, r.text
    assert "TopSecret99" not in r.text and r.json()["url_redacted"] == "rtsp://***@127.0.0.1:1/x"
    assert "TopSecret99" not in client.get("/api/v1/channels").text
    assert "TopSecret99" not in client.get("/api/v1/system/audit").text
    assert "TopSecret99" not in client.get("/api/v1/channels/2/diagnostics").text


def test_channel_url_rejected(client):
    h = login(client)
    r = client.put("/api/v1/channels/2", json={"url": "rtsp://169.254.169.254/x"}, headers=h)
    assert r.status_code == 422


def test_disable_channel(client):
    h = login(client)
    r = client.put("/api/v1/channels/3", json={"enabled": False}, headers=h)
    assert r.json()["state"] == "disabled"


def test_settings_roundtrip_and_validation(client):
    h = login(client)
    s = client.get("/api/v1/settings").json()
    assert s["thresholds"]["gunshot_like"]["threshold"] >= 0.6  # conservative default
    s["retention_days"] = 7
    assert client.put("/api/v1/settings", json=s, headers=h).json()["retention_days"] == 7
    s["ollama"]["url"] = "file:///etc/passwd"
    assert client.put("/api/v1/settings", json=s, headers=h).status_code == 422


def test_users_crud(client):
    h = login(client)
    r = client.post("/api/v1/users", json={"username": "newbie", "password": "short", "role": "viewer"}, headers=h)
    assert r.status_code == 400
    r = client.post("/api/v1/users", json={"username": "newbie", "password": "a-long-password", "role": "viewer"}, headers=h)
    assert r.status_code == 200 and "password" not in r.text
    me = client.get("/api/v1/auth/me").json()
    assert client.patch(f"/api/v1/users/{me['id']}", json={"role": "viewer"}, headers=h).status_code == 400


def test_telegram_token_write_only(client):
    h = login(client)
    tok = "123456789:AAH" + "x" * 32
    r = client.put("/api/v1/automation/telegram", json={"enabled": True, "chat_id": "-100123", "bot_token": tok}, headers=h)
    assert r.status_code == 200 and tok not in r.text and r.json()["token_set"] is True


def test_webhook_ssrf_blocked(client):
    h = login(client)
    r = client.post("/api/v1/automation/webhooks", json={"name": "x", "url": "https://127.0.0.1/hook"}, headers=h)
    assert r.status_code == 422


def test_rules_crud(client):
    h = login(client)
    r = client.post("/api/v1/automation/rules", json={"name": "Glass", "categories": ["glass_break"]}, headers=h)
    assert r.status_code == 200 and r.json()["categories"] == ["glass_break"]
    assert client.post("/api/v1/automation/rules", json={"name": "Bad", "categories": ["unicorn"]}, headers=h).status_code == 422


def test_transcript_search_export(client, cfg):
    e = client.app.state.engine
    from echosentinel.db import iso, utcnow

    now = iso(utcnow())
    e.db.insert("INSERT INTO segments(channel_id,start,end,text,kind) VALUES(1,?,?,'=cmd keep an eye on the front','speech')", (now, now))
    h = login(client, "op")
    items = client.get("/api/v1/transcripts", params={"q": "front"}).json()["items"]
    assert len(items) == 1 and items[0]["recording_id"] is None
    csv_ = client.get("/api/v1/transcripts/export", params={"format": "csv"})
    assert "'=cmd" in csv_.text and "attachment" in csv_.headers["content-disposition"]
    assert client.get("/api/v1/transcripts", params={"q": '") OR 1=1 --'}).status_code == 200
    del h


def test_event_review(client):
    e = client.app.state.engine
    from echosentinel.db import iso, utcnow

    eid = e.db.insert("INSERT INTO events(channel_id,at,category,label,score,model) VALUES(1,?,'barking','Dog',0.7,'t')", (iso(utcnow()),))
    h = login(client, "op")
    r = client.patch(f"/api/v1/events/{eid}", json={"status": "dismissed", "note": "neighbour's dog"}, headers=h)
    assert r.json()["status"] == "dismissed"
    assert client.get("/api/v1/events/stats").json()["unreviewed"] == 0
    assert client.get(f"/api/v1/events/{eid}/clip").status_code == 404  # no recording -> honest 404


def test_analytics_shape(client):
    login(client)
    a = client.get("/api/v1/analytics", params={"range": "7d"}).json()
    assert len(a["uptime"]) == 4 and a["stt_latency_ms"] is None


def test_pipeline_reports_disabled_honestly(client):
    login(client)
    p = client.get("/api/v1/system/pipeline").json()
    assert p["stt"]["state"] == "disabled" and p["classifier"]["state"] == "disabled"
    assert p["diarization"]["state"] == "unavailable"
    assert p["streams"] == {"online": 0, "total": 4}


def test_websocket_requires_auth_and_origin(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/live") as ws:
            ws.receive_json()
    login(client)
    with client.websocket_connect("/ws/live") as ws:
        assert ws.receive_json()["type"] == "hello"
        assert ws.receive_json()["type"] == "channels"
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/live", headers={"origin": "http://evil.example"}) as ws:
            ws.receive_json()


def test_path_traversal_recording(client):
    e = client.app.state.engine
    rid = e.db.insert("INSERT INTO recordings(channel_id,path,start,status) VALUES(1,'../../etc/passwd','2026-01-01T00:00:00Z','complete')")
    login(client)
    assert client.get(f"/api/v1/recordings/{rid}/audio").status_code == 404


def test_retention_purges_old_but_keeps_bookmarked(client):
    e = client.app.state.engine
    e.db.insert("INSERT INTO segments(channel_id,start,end,text,kind) VALUES(1,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:01.000Z','old','speech')")
    e.db.insert(
        "INSERT INTO events(channel_id,at,category,label,score,model,status) VALUES(1,'2020-01-01T00:00:00.000Z','barking','Dog',0.7,'t','bookmarked')"
    )
    import asyncio

    asyncio.run_coroutine_threadsafe(e.recorder.retention_once(), e.bus.loop).result(10)
    assert not e.db.query("SELECT id FROM segments WHERE text='old'")  # purged (by this or the startup pass)
    assert e.db.query("SELECT id FROM events WHERE status='bookmarked'")  # bookmarked evidence kept


def test_logout(client):
    h = login(client)
    assert client.post("/api/v1/auth/logout", headers=h).status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401

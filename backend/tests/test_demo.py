"""Demo mode: real FFmpeg-decoded synthetic signal on CH01, genuinely unreachable CH02-04, isolated DB."""

from __future__ import annotations

import time

from conftest import login, make_settings, seed_users
from fastapi.testclient import TestClient

from echosentinel.main import create_app


def test_demo_mode_isolated_and_labelled(tmp_path):
    cfg = make_settings(tmp_path, demo_mode=True, secret_key=None)
    seed_users(cfg)
    assert cfg.db_path.name == "demo.db"
    with TestClient(create_app(cfg)) as c:
        assert c.get("/api/v1/meta").json()["demo_mode"] is True
        login(c)
        deadline = time.time() + 20
        chans = []
        while time.time() < deadline:
            chans = c.get("/api/v1/channels").json()
            if chans[0]["state"] == "online" and all(x["state"] in ("offline", "error") for x in chans[1:]):
                break
            time.sleep(0.5)
        assert chans[0]["state"] == "online" and chans[0]["demo"] is True
        assert all(x["state"] in ("offline", "error") for x in chans[1:])
        assert "(demo)" in chans[0]["name"]
    assert not (tmp_path / "echosentinel.db").exists()

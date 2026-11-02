from __future__ import annotations

import os

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from echosentinel.api import deps
from echosentinel.config import Settings
from echosentinel.db import Database, iso, utcnow
from echosentinel.main import create_app
from echosentinel.security import hash_password

PASSWORD = "correct-horse-battery"


def make_settings(tmp_path, **kw) -> Settings:
    base = dict(
        data_dir=tmp_path,
        secret_key=Fernet.generate_key().decode(),
        stt_enabled=False,
        classifier_enabled=False,
        connect_timeout_s=3.0,
        reconnect_base_s=0.5,
        reconnect_max_s=2.0,
        frontend_dist=tmp_path / "nodist",
    )
    base.update(kw)
    return Settings(**base)


def seed_users(cfg: Settings) -> None:
    db = Database(cfg.db_path)
    for name, role in (("admin", "admin"), ("op", "operator"), ("viewer", "viewer")):
        if not db.one("SELECT id FROM users WHERE username=?", (name,)):
            db.insert(
                "INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)", (name, hash_password(PASSWORD), role, iso(utcnow()))
            )
    db.close()


@pytest.fixture(autouse=True)
def _reset_ratelimit():
    deps.login_limiter.hits.clear()
    yield


@pytest.fixture
def cfg(tmp_path):
    c = make_settings(tmp_path)
    seed_users(c)
    return c


@pytest.fixture
def client(cfg):
    with TestClient(create_app(cfg), base_url="http://testserver") as c:
        yield c


def login(c: TestClient, user: str = "admin") -> dict:
    r = c.post("/api/v1/auth/login", json={"username": user, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"X-CSRF-Token": c.cookies.get("es_csrf")}


RTSP_URL = os.environ.get("ES_TEST_RTSP_URL")  # e.g. rtsp://cam:pass@127.0.0.1:8554/ch1

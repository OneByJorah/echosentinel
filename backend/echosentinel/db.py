"""SQLite storage with versioned migrations.

SQLite (WAL) is the deliberate default for a single-node, four-channel install: zero ops,
FTS5 full-text search, crash-safe. All access goes through a single connection guarded by a
lock and executed in a worker thread so the event loop never blocks.
"""

from __future__ import annotations

import asyncio
import sqlite3
import threading
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path
from typing import Any


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=5000")
        self.migrate()

    # -- migrations -----------------------------------------------------------------------
    def migrate(self) -> int:
        with self._lock:
            self._conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)")
            done = {r[0] for r in self._conn.execute("SELECT version FROM schema_migrations")}
            files = sorted(
                (f for f in resources.files("echosentinel.migrations").iterdir() if f.name.endswith(".sql")),
                key=lambda f: f.name,
            )
            applied = 0
            for f in files:
                version = int(f.name.split("_", 1)[0])
                if version in done:
                    continue
                self._conn.execute("BEGIN")
                try:
                    for stmt in _split_sql(f.read_text()):
                        self._conn.execute(stmt)
                    self._conn.execute("INSERT INTO schema_migrations VALUES (?, ?)", (version, iso(utcnow())))
                    self._conn.execute("COMMIT")
                    applied += 1
                except Exception:
                    self._conn.execute("ROLLBACK")
                    raise
            return applied

    # -- sync helpers (used from threads) ----------------------------------------------------
    def execute(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, params)

    def query(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
        with self._lock:
            r = self._conn.execute(sql, params).fetchone()
            return dict(r) if r else None

    def insert(self, sql: str, params: tuple | dict = ()) -> int:
        with self._lock:
            return int(self._conn.execute(sql, params).lastrowid or 0)

    # -- async wrappers -----------------------------------------------------------------------
    async def aexecute(self, sql: str, params: tuple | dict = ()) -> int:
        cur = await asyncio.to_thread(self.execute, sql, params)
        return cur.rowcount

    async def aquery(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.query, sql, params)

    async def aone(self, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
        return await asyncio.to_thread(self.one, sql, params)

    async def ainsert(self, sql: str, params: tuple | dict = ()) -> int:
        return await asyncio.to_thread(self.insert, sql, params)

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def _split_sql(script: str) -> list[str]:
    """Split a migration into statements, keeping trigger bodies (BEGIN ... END;) intact."""
    stmts: list[str] = []
    buf: list[str] = []
    in_trigger = False
    for line in script.splitlines():
        stripped = line.strip()
        if stripped.startswith("--") or not stripped:
            continue
        buf.append(line)
        upper = stripped.upper()
        if upper.startswith("CREATE TRIGGER"):
            in_trigger = True
        if in_trigger:
            if upper == "END;":
                stmts.append("\n".join(buf))
                buf, in_trigger = [], False
        elif stripped.endswith(";"):
            stmts.append("\n".join(buf))
            buf = []
    if buf:
        stmts.append("\n".join(buf))
    return stmts

"""`echosentinel` command line: serve, create-user, reset-password, gen-secret, migrate, retention."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

from cryptography.fernet import Fernet


def _db():
    from .config import get_settings
    from .db import Database

    cfg = get_settings()
    return Database(cfg.db_path), cfg


def cmd_serve(a) -> None:
    import uvicorn

    from .config import get_settings
    from .main import create_app

    cfg = get_settings()
    uvicorn.run(
        create_app(cfg),
        host=a.host or cfg.host,
        port=a.port or cfg.port,
        proxy_headers=True,
        forwarded_allow_ips=",".join(cfg.trusted_proxies),
        log_level="info",
    )


def _read_password(a) -> str:
    pw = os.environ.get("ES_NEW_PASSWORD")
    if a.stdin:
        pw = sys.stdin.readline().rstrip("\n")
    if not pw:
        pw = getpass.getpass("Password: ")
        if pw != getpass.getpass("Repeat: "):
            sys.exit("Passwords do not match")
    return pw


def cmd_create_user(a) -> None:
    from .db import iso, utcnow
    from .security import hash_password, validate_new_password

    db, _ = _db()
    pw = _read_password(a)
    try:
        validate_new_password(pw)
    except ValueError as e:
        sys.exit(str(e))
    if db.one("SELECT id FROM users WHERE username=?", (a.username,)):
        sys.exit(f"User {a.username!r} already exists")
    db.insert("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)", (a.username, hash_password(pw), a.role, iso(utcnow())))
    db.insert("INSERT INTO audit_log(at,username,action,target) VALUES(?,?,?,?)", (iso(utcnow()), "cli", "user_create", f"user:{a.username}"))
    print(f"Created {a.role} user {a.username!r}")


def cmd_reset_password(a) -> None:
    from .security import hash_password, validate_new_password

    db, _ = _db()
    row = db.one("SELECT id FROM users WHERE username=?", (a.username,))
    if not row:
        sys.exit("No such user")
    pw = _read_password(a)
    try:
        validate_new_password(pw)
    except ValueError as e:
        sys.exit(str(e))
    db.execute("UPDATE users SET password_hash=?, disabled=0 WHERE id=?", (hash_password(pw), row["id"]))
    db.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
    print("Password reset; existing sessions revoked")


def cmd_gen_secret(_a) -> None:
    print(Fernet.generate_key().decode())


def cmd_migrate(_a) -> None:
    db, cfg = _db()
    print(f"Database {cfg.db_path} is at the latest schema")


def cmd_retention(_a) -> None:
    from .config import get_settings
    from .engine import Engine

    async def run():
        e = Engine(get_settings())
        res = await e.recorder.retention_once()
        print(res)
        e.db.close()

    asyncio.run(run())


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="echosentinel", description="EchoSentinel audio surveillance server")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the server")
    s.add_argument("--host")
    s.add_argument("--port", type=int)
    s.set_defaults(fn=cmd_serve)
    for name, fn in (("create-user", cmd_create_user), ("reset-password", cmd_reset_password)):
        c = sub.add_parser(name)
        c.add_argument("--username", required=True)
        if name == "create-user":
            c.add_argument("--role", choices=["admin", "operator", "viewer"], default="viewer")
        c.add_argument("--stdin", action="store_true", help="read password from stdin (for automation)")
        c.set_defaults(fn=fn)
    sub.add_parser("gen-secret", help="print a new ES_SECRET_KEY").set_defaults(fn=cmd_gen_secret)
    sub.add_parser("migrate", help="apply database migrations").set_defaults(fn=cmd_migrate)
    sub.add_parser("retention", help="run retention once").set_defaults(fn=cmd_retention)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()

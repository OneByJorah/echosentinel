#!/usr/bin/env bash
# Local development: backend on :8640 (demo mode by default) + Vite on :5173 with proxy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ES_DATA_DIR="${ES_DATA_DIR:-$ROOT/data}"
export ES_DEMO_MODE="${ES_DEMO_MODE:-true}"
cd "$ROOT/backend"
[[ -d .venv ]] || { python3 -m venv .venv; .venv/bin/pip install -q -e ".[dev]"; }
if ! .venv/bin/python -c "import sqlite3,os;c=sqlite3.connect(os.environ['ES_DATA_DIR']+'/demo.db');print(c.execute('select count(*) from users').fetchone()[0])" 2>/dev/null | grep -qv '^0$'; then
  mkdir -p "$ES_DATA_DIR"
  echo "demo-password-123" | .venv/bin/echosentinel create-user --username demo --role admin --stdin || true
  echo "Demo login: demo / demo-password-123"
fi
.venv/bin/echosentinel serve &
trap 'kill %1' EXIT
cd "$ROOT/frontend" && { [[ -d node_modules ]] || npm ci; } && npm run dev

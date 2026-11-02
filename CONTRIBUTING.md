# Contributing

Thanks for helping improve EchoSentinel.

1. Fork, then create a branch from `main`.
2. Backend: `cd backend && python -m venv .venv && .venv/bin/pip install -e ".[dev]"`, then `ruff check . && ruff format . && pytest -q`.
3. Live RTSP tests: `./scripts/test-rtsp-env.sh`, then `ES_TEST_RTSP_URL=rtsp://cam:s3cretPass@127.0.0.1:8554/ch1 pytest -q`.
4. Frontend: `cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build`.
5. UI changes: run `frontend/e2e/visual-qa.mjs` and attach screenshots to the PR.

Ground rules:

* **Never fabricate data.** Production code paths must only display values that come from real audio, real models or real system metrics. Synthetic data belongs in `demo.py` and must be flagged `demo`.
* **Never leak secrets.** Stream URLs and tokens stay server-side. Add a test if you touch anything that returns channel data.
* Keep API changes in sync with `docs/API.md` and `frontend/src/lib/types.ts`.

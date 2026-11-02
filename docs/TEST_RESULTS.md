# Test results: v1.0.0

Recorded on 2026-11-02 in the build environment described in [ENVIRONMENT_AUDIT.md](ENVIRONMENT_AUDIT.md) (2 vCPU, 7.8 GB RAM, no GPU, FFmpeg 6.1.1, Python 3.13, Node 22). CI runs the same suites on every push. See `.github/workflows/ci.yml`.

## Summary

| Suite | Result |
|---|---|
| Backend lint (`ruff check`, `ruff format --check`) | ✅ pass |
| Backend tests (`pytest`) | ✅ **64 passed**, 0 skipped (with live RTSP server). The suite was run 3× consecutively without flakes. |
| Frontend lint / typecheck (`eslint`, `tsc`) | ✅ pass |
| Frontend unit tests (`vitest`) | ✅ **15 passed** |
| Frontend production build (`vite build`) | ✅ pass |
| Browser visual QA (`frontend/e2e/visual-qa.mjs`, Playwright/Chromium) | ✅ **17/17 checks** in production mode and in demo mode |
| Python dependency audit (`pip-audit`) | ✅ no known vulnerabilities, after upgrading FastAPI 0.162, Starlette 1.10 and cryptography 50.0.2 |
| npm audit (all deps) | ✅ 0 vulnerabilities, after upgrading to React Router 7.18.5, Vite 8.3.5, Vitest 5.0.5 and postcss 8.5.32, and overriding minimatch to 11.0.4 |
| Docker image build + container smoke test | ✅ GitHub Actions: image builds, runs as non-root, `/healthz`, `/api/v1/meta` and the UI respond |

## Backend coverage by area

| File | Tests | What is covered |
|---|---|---|
| `test_units.py` | 30 | scrypt hashing; Fernet secret box; URL redaction; RTSP SSRF/injection rejection (scheme, link-local metadata, outside allowlist, whitespace, `file:`, option smuggling); webhook SSRF rules; migration splitting and idempotency; FTS5 search and query sanitising; CSV injection guard; level metering from real PCM and silence; energy segmenter; YAMNet label → category mapping; FFmpeg error classification; quiet hours across midnight; recording-name parsing; Ollama summary citation filtering and evidence delimiting |
| `test_api.py` | 23 | health and security headers; auth required everywhere; login rate limit; CSRF enforcement; 4 slots always present; RBAC for viewer/operator/admin; **RTSP password never present in channel, diagnostics or audit responses**; URL rejection; disable channel; settings validation (rejects `file://` Ollama URL); user CRUD incl. self-demotion guard; write-only Telegram token; webhook SSRF; rules validation; transcript search and CSV export; event review and honest 404 clip; analytics shape; pipeline honesty (disabled/unavailable); WebSocket auth and cross-origin rejection; recording path traversal; retention keeps bookmarked evidence; logout |
| `test_pipeline.py` | 9 | thresholds, cooldown and duplicate suppression; disabled categories never fire; STT persistence and publishing (speaker always null); hot path levels and windowing; queue backpressure drops oldest; classifier `not_configured` produces nothing; embedded label loading; STT state when weights absent; **indexer startup-race regression** |
| `test_demo.py` | 1 | demo mode: CH01 online from FFmpeg-decoded synthetic signal, CH02–04 genuinely offline, isolated `demo.db` |
| `test_integration_rtsp.py` | 1 | **Live RTSP end to end** (below) |

### Live RTSP integration (real server, real FFmpeg)

Environment: mediamtx v1.15.3 with an authenticated read user; FFmpeg publishing gated 300 Hz tone + noise as AAC 16 kHz mono (`scripts/test-rtsp-env.sh`).

| Check | Result |
|---|---|
| CH01 valid credentials → `online`, codec `aac`, 16000 Hz, recording | ✅ |
| CH02 wrong password → `error` "Authentication failed (check credentials)" | ✅ |
| CH03 non-existent path → `offline`/`error` | ✅ |
| CH04 refused port → `offline` "Connection refused" with `retry_at` backoff | ✅ |
| One online / three offline derived from probes, not hardcoded | ✅ |
| Password absent from every API response | ✅ |
| `/ws/live` levels: 5 peaks per message; both tone bursts (>0.2) and noise floor (<0.05) observed | ✅ |
| `/ws/audio/1` delivers format header + 3200-byte PCM frames | ✅ |
| `/ws/audio/4` (offline) refused | ✅ |
| Segment indexed while writing; HTTP Range request returns 206 with exactly 1024 bytes | ✅ |
| Timeline returns coverage and non-zero waveform peaks | ✅ |
| Clip export returns valid MP3 with `X-EchoSentinel-Meta` | ✅ |
| Manual reconnect, diagnostics (no credential leakage), connection test endpoint | ✅ |

## Browser visual QA (Playwright, Chromium)

Run against both a production-mode server (real RTSP) and a demo-mode server, at 1600×900, 820×1180 and 390×844 (2× DPR):

| Check | Production | Demo |
|---|---|---|
| 4 channel cards rendered | ✅ | ✅ |
| No credentials anywhere in DOM | ✅ | ✅ |
| Transcription / AI Recognition tabs switch | ✅ | ✅ |
| Reconnect on offline card | ✅ | ✅ |
| Live listening starts (user gesture) | ✅ | ✅ |
| Navigation to all 8 secondary pages | ✅ | ✅ |
| Timeline click-to-seek | ✅ | ✅ |
| Tablet / mobile: no horizontal overflow | ✅ | ✅ |
| Reduced-motion context loads | ✅ | ✅ |
| Uncaught page errors | none | none |

Console noise: one expected `401` per session from the pre-login `/auth/me` probe.

Screenshots: [`docs/screenshots/`](screenshots/).

## Bugs found and fixed during QA

1. **Segments written with no data until ffmpeg exited.** The segment muxer buffered the MP3 output. Fixed with `flush_packets=1` on the segment output, and covered by the live RTSP test.
2. **Indexer startup race.** The newest segment could be finalised at 0.5 s before the worker reported "recording", and it was never revisited. That broke transcript-to-recording links. The indexer is now self-healing: it looks at mtime and re-examines any file whose size changes. A regression test covers this.
3. **Vulnerable dependency pins** were upgraded (see Summary).
4. Demo mode ignored disabled categories. It now respects thresholds.
5. **Docker container failed to start** (first CI run): the `/data` volume was root-owned while the app runs as UID 10001. The directory is now created with the right owner in the image.

## Not tested (and why)

| Item | Reason | Mitigation |
|---|---|---|
| Real Whisper transcription accuracy and latency | Model weights could not be downloaded in the sandbox | Pipeline tested with stand-in engine. On your host, run `fetch-models.sh` and check System → STT = ready. |
| Real YAMNet scores and false-alarm rate | Same | Same; thresholds default conservative |
| Ollama summaries against a real model | Ollama not available | Mocked HTTP API test, including injection guards |
| Non-English and overlapping speech | Needs real STT | Whisper is multilingual; language auto-detect is enabled by default |
| Disk-full behaviour on a real full disk | Not safe to fill the sandbox disk | Logic covered by the disk guard (`min_free_gb`); the threshold can be raised to trigger it |
| Safari / Firefox | Only Chromium available | Standard Web Audio, MP3 and WebSocket APIs only |

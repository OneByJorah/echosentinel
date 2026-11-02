# Progress

## v1.0.0: 2026-11-02

| Phase | Status | Notes |
|---|---|---|
| 0 Discovery | ✅ | `scripts/env-audit.sh` (read-only); build-host audit in ENVIRONMENT_AUDIT.md. **To do on your host:** run the audit before installing. |
| 1 Architecture | ✅ | ARCHITECTURE.md, API.md, storage/retention, risk/rollback |
| 2 Scaffold | ✅ | backend/ (FastAPI, pinned deps, ruff, pytest), frontend/ (Vite, TS, Tailwind, ESLint, Vitest), `.env.example`, CI |
| 3 Real channels | ✅ | Per-channel FFmpeg supervision, probing, levels, backoff with jitter, browser listening; validated against a real RTSP server |
| 4 Transcription | ✅ code / ⚠️ model unverified | VAD with faster-whisper, persistence, FTS search, export, click-to-play. Real-model run is pending on the target host. |
| 5 Classification + Ollama | ✅ code / ⚠️ model unverified | YAMNet wrapper, categories, thresholds, cooldowns, review workflow, Ollama summaries with citations |
| 6 Recording + timeline | ✅ | Crash-safe MP3 segments, self-healing index, peaks, Range playback, clip export, retention, disk guard |
| 7 Alerts + admin | ✅ | Telegram, webhooks, rules, RBAC, audit log, users, settings, backup/restore, diagnostics |
| 8 QA + hardening | ✅ | 64 backend tests, 15 frontend tests, 17 browser checks, dependency audits clean |
| 9 Deployment | ⏸️ awaiting owner | Needs your approval and your host: install, fetch models, add cameras, verify STT and classifier show ready |

## Next steps on the real host

1. Run `./scripts/env-audit.sh`. Check for existing NVR services and port conflicts (8640).
2. `sudo ./scripts/install.sh`, then `fetch-models.sh`, then create an admin user.
3. Add the four RTSP URLs under Channels and use **Test** on each.
4. Confirm the System page shows STT `ready` and Sound classifier `ready`.
5. Speak near the online microphone. Transcripts should appear within about 3 s (CPU, `base`).
6. Set up Telegram and send a test, then add a rule (for example glass_break and gunshot_like).
7. Put it behind Tailscale Serve or Caddy for phone access, and set `ES_SECURE_COOKIES=true`.

## Approvals required to go live

* Installing system packages (ffmpeg, python3-venv) if missing. The installer asks first.
* Exposing the UI beyond loopback (reverse proxy / Tailscale).
* Recording-consent obligations for the monitored locations.

## Roadmap ideas

* Speaker diarization (pyannote) behind a validation gate
* Opus/WebRTC live listening for lower bandwidth on mobile data
* Per-channel schedules (record or analyse only at certain hours)
* ONVIF discovery of camera RTSP URLs
* Scheduled daily Ollama digest delivered to Telegram

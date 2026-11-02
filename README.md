<div align="center">

# EchoSentinel

**Audio Surveillance • AI Recognition • Transcription**

Self-hosted, audio-only RTSP monitoring: live listening, 24/7 recording, local speech-to-text and acoustic event detection. Nothing leaves your network.

[![CI](https://github.com/OneByJorah/echosentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/OneByJorah/echosentinel/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-FFB300)
![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-3776AB)
![React 18](https://img.shields.io/badge/react-18-61DAFB)
![Self-hosted](https://img.shields.io/badge/cloud-none-0a0a09)

<img src="docs/screenshots/desktop-live.png" alt="EchoSentinel live audio dashboard" width="100%">

</div>

## Why EchoSentinel

Most NVRs treat audio as an afterthought on a video stream. EchoSentinel is built only for audio. It pulls the audio track from up to N RTSP sources (four by default), keeps it on disk, tells you what was said, flags sounds that matter (barking, alarms, glass, gunshot-like bangs, screams, vehicles, knocking), and lets you listen live from your phone. All of it runs on your own hardware.

It is also **honest by design**. If a camera is down, the card says why. If a model isn't installed, the panel says *Not configured* rather than inventing detections. AI summaries are labelled as AI and cite the transcript lines they came from.

## Features

| | |
|---|---|
| 🎧 **Live audio wall** | 2×2 (or list) channel cards with real decoded waveforms, codec/sample-rate/latency, one-click **Listen** with volume/mute, recording indicator, per-channel event count |
| 🔌 **Resilient RTSP** | One supervised FFmpeg per channel, TCP/UDP, stall watchdog, exponential backoff + jitter, classified failure reasons (auth / not found / refused / timeout / no audio / codec), manual reconnect, diagnostics |
| 🗣️ **Local transcription** | faster-whisper (CPU int8 or CUDA) behind two-stage VAD (energy gate → Silero), hallucination filtering, low-confidence speech marked *unintelligible*, full-text search, TXT/JSON/CSV export, click-to-play |
| 🔊 **Acoustic events** | YAMNet (521 AudioSet classes) mapped to 8 categories, with per-category thresholds, cooldowns and duplicate suppression. Review workflow: acknowledge, dismiss, bookmark, notes, ±5 s clips |
| 🕒 **Recording & timeline** | Crash-safe hourly MP3 segments aligned to wall-clock time, synchronised timeline (waveform, speech, events, gaps, offline), seek/skip/speed/zoom, clip export with metadata |
| 🧠 **Ollama summaries** | Your local LLM summarises a time window from stored transcripts and detections, with injection-hardened prompts and verified citations |
| 🔔 **Automation** | Telegram alerts with quiet hours and minimal-content defaults, HMAC-signed webhooks with SSRF protection, rule engine |
| 📊 **Analytics** | Uptime/outages per channel, recording coverage, events by category and hour, speech minutes, STT/classifier latency |
| 🔐 **Security** | Admin/operator/viewer roles, CSRF, rate-limited login, audit log, encrypted stream credentials, strict CSP, loopback-only by default, systemd sandboxing |
| 📱 **Anywhere** | Responsive layout with mobile tab bar, installable PWA, keyboard shortcuts (`?`), reduced-motion support, WCAG-AA contrast |
| 🧪 **Demo mode** | A real FFmpeg-decoded synthetic signal with clearly labelled sample data, kept in a separate database |

## Quick start

### Try the demo (about 60 seconds)

```bash
git clone https://github.com/OneByJorah/echosentinel.git && cd echosentinel
./scripts/dev.sh           # backend in demo mode + Vite dev server
# open http://localhost:5173 and sign in as demo / demo-password-123
```

You need Python ≥ 3.11, Node ≥ 20 and FFmpeg.

### Production (Linux host, systemd)

```bash
(cd frontend && npm ci && npm run build)
sudo ./scripts/install.sh                                   # idempotent; never touches firewall or other services
sudo -u echosentinel ./scripts/fetch-models.sh /var/lib/echosentinel/models   # Whisper + YAMNet, one-time download
sudo -u echosentinel bash -c 'set -a; . /etc/echosentinel/echosentinel.env; echosentinel create-user --username admin --role admin'
sudo systemctl enable --now echosentinel
```

Open `http://127.0.0.1:8640`, then go to **Channels** to add your RTSP URLs. For remote or phone access, put it behind HTTPS (Caddy or Tailscale Serve). See [Deployment](docs/DEPLOYMENT.md).

### Docker (optional)

```bash
cp .env.example .env   # set ES_SECRET_KEY (echosentinel gen-secret)
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

## Screenshots

| Production mode: 1 real stream, 3 real failures | Recordings & synchronised timeline |
|---|---|
| <img src="docs/screenshots/desktop-live-production.png" alt="Production live view"> | <img src="docs/screenshots/desktop-recordings.png" alt="Recordings"> |
| **AI events review** | **Transcripts** |
| <img src="docs/screenshots/desktop-events.png" alt="AI events"> | <img src="docs/screenshots/desktop-transcripts.png" alt="Transcripts"> |
| **Channels (credentials never shown)** | **System status (honest model states)** |
| <img src="docs/screenshots/desktop-channels.png" alt="Channels"> | <img src="docs/screenshots/desktop-system.png" alt="System"> |

<p align="center">
<img src="docs/screenshots/mobile-live.png" alt="Mobile" width="260">&nbsp;&nbsp;
<img src="docs/screenshots/tablet-live.png" alt="Tablet" width="380">
</p>

**Where each screenshot comes from.** Shots with the amber *DEMO MODE* banner (hero, recordings, events, transcripts, mobile, tablet) use demo mode: a real FFmpeg-decoded synthetic signal with canned, clearly badged transcripts and detections. The production, channels and system shots come from production mode running against a real RTSP server (mediamtx). That setup has one live authenticated AAC stream and three endpoints that genuinely fail: wrong password, a protected path, and a refused port. Whisper and YAMNet show *Error* and *Not configured* because their weights weren't downloaded in the build sandbox. See [Test results](docs/TEST_RESULTS.md).

## How it works

```
RTSP ──► FFmpeg (1/channel) ──┬─► PCM 16 kHz ──┬─► level meter ──────────► WebSocket ─► UI
                              │                ├─► live listen fan-out ──► WebSocket ─► Web Audio
                              │                ├─► VAD ─► faster-whisper ─► transcripts (SQLite FTS5)
                              │                └─► YAMNet ─► thresholds ─► events ─► Telegram / webhooks
                              └─► MP3 segments (hourly, wall-clock aligned) ─► timeline, clips, retention
```

Full design rationale: [Architecture](docs/ARCHITECTURE.md). REST and WebSocket contract: [API](docs/API.md).

## Configuration

All settings are `ES_*` environment variables (see [`.env.example`](.env.example)). Operator settings such as retention, thresholds and Ollama are edited in the UI.

| Variable | Default | |
|---|---|---|
| `ES_SECRET_KEY` | — | **Required** to store stream credentials and tokens (encrypted at rest) |
| `ES_HOST` / `ES_PORT` | `127.0.0.1` / `8640` | Keep on loopback behind a TLS proxy |
| `ES_DATA_DIR` | `./data` | Database, models, recordings |
| `ES_CHANNEL_SLOTS` | `4` | Number of channel cards |
| `ES_RTSP_ALLOWED_NETWORKS` | RFC1918 + CGNAT + loopback | SSRF guard for camera URLs |
| `ES_STT_MODEL` / `ES_STT_DEVICE` | `base` / `auto` | Any faster-whisper model; CUDA is used automatically when present |
| `ES_CLASSIFIER_MODEL_PATH` | `$ES_DATA_DIR/models/yamnet.tflite` | |
| `ES_DEMO_MODE` | `false` | Synthetic data in an isolated `demo.db` |

## Storage sizing

At 48 kbit/s mono, each channel uses about **21 MB per hour, or 0.5 GB per day**. Four channels for 30 days comes to about 60 GB. Retention by age and by total quota is enforced automatically. When free space drops below a set minimum, recording pauses rather than filling the disk.

## Documentation

* [Deployment](docs/DEPLOYMENT.md): install, HTTPS, GPU, upgrade, rollback
* [Operations](docs/OPERATIONS.md): daily use, channel states, tuning, backup, troubleshooting
* [Security](docs/SECURITY.md): threat model and controls
* [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md)
* [Test results](docs/TEST_RESULTS.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Progress](docs/PROGRESS.md) · [Environment audit](docs/ENVIRONMENT_AUDIT.md)

## Development

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -e ".[dev,all]"
.venv/bin/ruff check . && .venv/bin/pytest -q
./scripts/test-rtsp-env.sh && ES_TEST_RTSP_URL=rtsp://cam:s3cretPass@127.0.0.1:8554/ch1 .venv/bin/pytest -q   # live RTSP tests
cd ../frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
ES_URL=http://127.0.0.1:8640 ES_USER=admin ES_PASS=... node e2e/visual-qa.mjs                   # Playwright visual QA
```

## Responsible use

EchoSentinel records people's voices. Recording conversations is regulated in many places, often requiring consent from one or all parties. Check the laws that apply to you, post notice where required, and keep retention short. Acoustic detections are probabilistic aids, not evidence.

## License

[MIT](LICENSE) © OneByJorah

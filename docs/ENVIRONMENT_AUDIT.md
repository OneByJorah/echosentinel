# Environment audit

Two audits matter:

1. **The build/CI environment** — recorded below, so test results can be read in context.
2. **Your target host** — run `./scripts/env-audit.sh > docs/ENVIRONMENT_AUDIT.host.md` on the machine that will run EchoSentinel *before* installing. It is read-only and never prints credentials or RTSP URLs.

## Build environment (where v1.0.0 was developed and tested)

| Item | Finding | Consequence |
|---|---|---|
| Model weights | `huggingface.co` and `storage.googleapis.com` blocked by sandbox egress policy | Real Whisper/YAMNet inference not exercised; stand-in engines in tests; documented in KNOWN_LIMITATIONS |
| Silero VAD | Available (bundled ONNX in faster-whisper 1.2.1) | Real VAD path importable |
| Ollama | Not running | Summaries tested against mocked API |
| Cameras | None | Real RTSP server (mediamtx v1.15.3) + FFmpeg AAC 16 kHz publisher with an authenticated read user used instead |
| GPU | None | CPU (int8) path is the default |

Raw output of `scripts/env-audit.sh` on the build host:

### EchoSentinel environment audit — vm — 2026-11-02T06:36:46Z

#### OS / hardware

```
Linux 6.18.44-fc-v185 x86_64
PRETTY_NAME="Ubuntu 24.04.5 LTS"
CPUs: 2
               total        used        free      shared  buff/cache   available
Mem:           7.8Gi       657Mi       5.3Gi        15Mi       2.2Gi       7.2Gi
```

#### GPU

```
no NVIDIA GPU / driver detected
```

#### Tooling

```
ffmpeg   ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers
ffprobe  ffprobe version 6.1.1-3ubuntu5 Copyright (c) 2007-2023 the FFmpeg developers
python3  Python 3.13.18
node     v22.23.4
npm      10.9.9
docker   Docker version 29.9.2, build a82e528
caddy    not installed
nginx    not installed
faster-whisper not installed
```

#### Disk

```
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda        252G   14G   29G  32% /
/dev/vda        252G   14G   29G  32% /
```

#### Listening ports (possible existing NVR / RTSP / Ollama services)

```
none of the usual ports in use
```

#### Services

```
no known NVR/RTSP/Ollama units
```

#### Ollama

```
Ollama API not reachable on 127.0.0.1:11434
```

#### Firewall (read-only)

```
```

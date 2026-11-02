# Deployment

Two supported paths. The **host install** is primary (systemd, non-root, sandboxed); **Docker Compose** is an optional alternative.

Before installing on a machine that already runs an NVR, run the read-only audit and keep the output:

```bash
./scripts/env-audit.sh > ENVIRONMENT_AUDIT.host.md
```

EchoSentinel never changes firewall rules, never stops other services and only writes inside its own data directory.

## 1. Host install (Debian / Ubuntu)

Requirements: Python ≥ 3.11, FFmpeg ≥ 5, ~1 GB RAM (+1–2 GB for the `base` Whisper model), disk for recordings (48 kbit/s ≈ **21 MB/hour/channel**, ~2 GB/day for four channels).

```bash
git clone https://github.com/OneByJorah/echosentinel.git && cd echosentinel
(cd frontend && npm ci && npm run build)          # build the UI
sudo ./scripts/install.sh                          # asks before apt-installing anything
sudo -u echosentinel ./scripts/fetch-models.sh /var/lib/echosentinel/models   # optional, one-time internet
```

Create the first admin (prompts for a password, min 10 chars):

```bash
sudo -u echosentinel bash -c 'set -a; . /etc/echosentinel/echosentinel.env; echosentinel create-user --username admin --role admin'
sudo systemctl enable --now echosentinel
systemctl status echosentinel
curl -s http://127.0.0.1:8640/readyz
```

Open `http://127.0.0.1:8640`, sign in, go to **Channels** and enter each RTSP URL (use **Test** first). URLs are encrypted at rest.

### HTTPS / remote access

Keep EchoSentinel on loopback and front it with:

* **Caddy** — `deploy/caddy/Caddyfile` (internal TLS, LAN/tailnet-only matcher), then set `ES_SECURE_COOKIES=true`.
* **Tailscale Serve** — `tailscale serve --bg --https=443 http://127.0.0.1:8640` for tailnet-only access.

The proxy must pass WebSockets (`/ws/live`, `/ws/audio/*`). Add the proxy address to `ES_TRUSTED_PROXIES` if it isn't on loopback.

### GPU

With an NVIDIA GPU and CUDA 12 + cuDNN 9 present, `ES_STT_DEVICE=auto` picks CUDA (float16). Larger models (`small`, `medium`, `large-v3`) become practical.

## 2. Docker Compose (optional)

```bash
cp .env.example .env && echosentinel gen-secret   # paste into ES_SECRET_KEY
docker compose -f deploy/docker/docker-compose.yml up -d --build
docker compose -f deploy/docker/docker-compose.yml exec echosentinel sh -c 'echosentinel create-user --username admin --role admin'
docker compose -f deploy/docker/docker-compose.yml exec echosentinel /app/scripts/fetch-models.sh /data/models
```

The container is read-only, drops all capabilities and is published on `127.0.0.1:8640` only.

## Upgrade

```bash
sudo ./scripts/backup.sh
git pull && (cd frontend && npm ci && npm run build)
sudo ./scripts/install.sh          # keeps env, DB, recordings
sudo systemctl restart echosentinel
```

## Rollback

```bash
sudo systemctl stop echosentinel
git checkout <previous-tag> && (cd frontend && npm ci && npm run build) && sudo ./scripts/install.sh
sudo ./scripts/restore.sh /var/backups/echosentinel/echosentinel-<stamp>.tar.gz --force
sudo systemctl start echosentinel
```

## Uninstall (keeps data unless you delete it yourself)

```bash
sudo systemctl disable --now echosentinel
sudo rm /etc/systemd/system/echosentinel.service /usr/local/bin/echosentinel
sudo rm -r /opt/echosentinel
# Data remains in /var/lib/echosentinel and config in /etc/echosentinel
```

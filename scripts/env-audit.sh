#!/usr/bin/env bash
# Phase-0 discovery on the TARGET host. Read-only; prints Markdown (no secrets, no RTSP URLs).
#   ./scripts/env-audit.sh > docs/ENVIRONMENT_AUDIT.host.md
set -uo pipefail
h() { echo; echo "## $1"; echo; }
echo "# EchoSentinel environment audit — $(hostname) — $(date -u +%FT%TZ)"
h "OS / hardware"
echo '```'; uname -srm; grep PRETTY_NAME /etc/os-release 2>/dev/null; echo "CPUs: $(nproc)"; free -h | head -2; echo '```'
h "GPU"
echo '```'; (command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv) || echo "no NVIDIA GPU / driver detected"; echo '```'
h "Tooling"
echo '```'
for t in ffmpeg ffprobe python3 node npm docker caddy nginx; do printf '%-8s ' "$t"; (command -v "$t" >/dev/null && "$t" -version 2>/dev/null | head -1 || "$t" --version 2>/dev/null | head -1) || echo "not installed"; done
python3 -c "import faster_whisper; print('faster-whisper', faster_whisper.__version__)" 2>/dev/null || echo "faster-whisper not installed"
echo '```'
h "Disk"
echo '```'; df -h / /var/lib 2>/dev/null; echo '```'
h "Listening ports (possible existing NVR / RTSP / Ollama services)"
echo '```'; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E ':(554|8554|8000|8080|8640|11434|5000|1935)\b' || echo "none of the usual ports in use"; echo '```'
h "Services"
echo '```'; systemctl list-units --type=service --no-pager 2>/dev/null | grep -Ei 'frigate|zoneminder|shinobi|mediamtx|go2rtc|blue|ollama|echosentinel' || echo "no known NVR/RTSP/Ollama units"; echo '```'
h "Ollama"
echo '```'; curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags 2>/dev/null | python3 -c "import json,sys; print('models:', [m['name'] for m in json.load(sys.stdin).get('models',[])])" 2>/dev/null || echo "Ollama API not reachable on 127.0.0.1:11434"; echo '```'
h "Firewall (read-only)"
echo '```'; (ufw status 2>/dev/null || nft list ruleset 2>/dev/null | head -20) || echo "unable to read (run as root)"; echo '```'

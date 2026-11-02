#!/usr/bin/env bash
# EchoSentinel host installer (Debian/Ubuntu). Idempotent and non-destructive:
#  - never overwrites an existing env file, database or recordings
#  - never touches firewall rules
#  - binds to 127.0.0.1; put deploy/caddy/Caddyfile (or your proxy) in front for HTTPS
set -euo pipefail

PREFIX=/opt/echosentinel
DATA=/var/lib/echosentinel
ETC=/etc/echosentinel
EXTRAS="${ECHOSENTINEL_EXTRAS:-all}"   # all | stt | classifier | none
SRC="$(cd "$(dirname "$0")/.." && pwd)"

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo $0)"; exit 1; }

echo "==> Checking system packages"
need=()
for p in ffmpeg python3 python3-venv; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
if ((${#need[@]})); then
  echo "Missing: ${need[*]}"
  read -r -p "Install them with apt now? [y/N] " a
  [[ $a == [yY] ]] && apt-get update && apt-get install -y "${need[@]}" || { echo "Install them and re-run."; exit 1; }
fi

echo "==> Service account"
id echosentinel >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin echosentinel

echo "==> Directories"
install -d -o echosentinel -g echosentinel -m 750 "$DATA" "$DATA/recordings" "$DATA/models"
install -d -m 750 "$ETC"

echo "==> Application into $PREFIX"
install -d "$PREFIX"
cp -a "$SRC/backend" "$PREFIX/"
if [[ -d "$SRC/frontend/dist" ]]; then
  install -d "$PREFIX/frontend"; rm -rf "$PREFIX/frontend/dist"; cp -a "$SRC/frontend/dist" "$PREFIX/frontend/dist"
else
  echo "   (frontend/dist missing — build it with: cd frontend && npm ci && npm run build)"
fi
python3 -m venv "$PREFIX/venv"
"$PREFIX/venv/bin/pip" install -q --upgrade pip
if [[ $EXTRAS == none ]]; then "$PREFIX/venv/bin/pip" install -q "$PREFIX/backend"
else "$PREFIX/venv/bin/pip" install -q "$PREFIX/backend[$EXTRAS]"; fi
ln -sf "$PREFIX/venv/bin/echosentinel" /usr/local/bin/echosentinel

echo "==> Environment file"
if [[ ! -f $ETC/echosentinel.env ]]; then
  sed -e "s|^ES_SECRET_KEY=.*|ES_SECRET_KEY=$("$PREFIX/venv/bin/echosentinel" gen-secret)|" \
      -e "s|^ES_DATA_DIR=.*|ES_DATA_DIR=$DATA|" "$SRC/.env.example" > "$ETC/echosentinel.env"
  echo "ES_FRONTEND_DIST=$PREFIX/frontend/dist" >> "$ETC/echosentinel.env"
  echo "   created $ETC/echosentinel.env (secret key generated; back it up — losing it means re-entering stream URLs)"
else
  echo "   kept existing $ETC/echosentinel.env"
fi
chown root:echosentinel "$ETC/echosentinel.env"; chmod 640 "$ETC/echosentinel.env"

echo "==> systemd unit"
install -m 644 "$SRC/deploy/systemd/echosentinel.service" /etc/systemd/system/echosentinel.service
systemctl daemon-reload
echo
echo "Next steps:"
echo "  1. Models (optional, needs internet once):  sudo -u echosentinel $SRC/scripts/fetch-models.sh $DATA/models"
echo "  2. First admin:   sudo -u echosentinel env \$(grep -v '^#' $ETC/echosentinel.env | xargs) echosentinel create-user --username admin --role admin"
echo "  3. Start:         systemctl enable --now echosentinel && systemctl status echosentinel"
echo "  4. Open:          http://127.0.0.1:8640 (or via your HTTPS reverse proxy)"

#!/usr/bin/env bash
# Restore a backup created by backup.sh. Refuses to overwrite without --force; keeps a copy of what it replaces.
set -euo pipefail
ARCHIVE="${1:?usage: restore.sh <archive.tar.gz> [--force]}"
FORCE=${2:-}
DATA="${ES_DATA_DIR:-/var/lib/echosentinel}"
ETC="${ES_ETC_DIR:-/etc/echosentinel}"
if systemctl is-active --quiet echosentinel 2>/dev/null; then echo "Stop the service first: systemctl stop echosentinel"; exit 1; fi
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
tar -C "$work" -xzf "$ARCHIVE"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [[ -f $DATA/echosentinel.db && $FORCE != --force ]]; then echo "Database exists; re-run with --force (a copy will be kept)"; exit 1; fi
[[ -f $DATA/echosentinel.db ]] && mv "$DATA/echosentinel.db" "$DATA/echosentinel.db.pre-restore-$stamp"
rm -f "$DATA/echosentinel.db-wal" "$DATA/echosentinel.db-shm"
cp -a "$work/echosentinel.db" "$DATA/"
if [[ -f $work/echosentinel.env ]]; then
  [[ -f $ETC/echosentinel.env ]] && cp -a "$ETC/echosentinel.env" "$ETC/echosentinel.env.pre-restore-$stamp"
  cp -a "$work/echosentinel.env" "$ETC/"
fi
[[ -d $work/recordings ]] && cp -an "$work/recordings/." "$DATA/recordings/"
chown -R echosentinel:echosentinel "$DATA" 2>/dev/null || true
echo "Restored. Start with: systemctl start echosentinel"

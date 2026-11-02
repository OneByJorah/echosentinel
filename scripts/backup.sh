#!/usr/bin/env bash
# Consistent online backup of the database + config. Recordings are included only with --with-recordings.
set -euo pipefail
DATA="${ES_DATA_DIR:-/var/lib/echosentinel}"
ETC="${ES_ETC_DIR:-/etc/echosentinel}"
OUT="${BACKUP_DIR:-/var/backups/echosentinel}"
WITH_REC=0; [[ ${1:-} == --with-recordings ]] && WITH_REC=1
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir -p "$OUT"; chmod 700 "$OUT"
for db in echosentinel.db; do
  [[ -f $DATA/$db ]] && python3 -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close()" "$DATA/$db" "$work/$db"
done
[[ -f $ETC/echosentinel.env ]] && cp -a "$ETC/echosentinel.env" "$work/"
if ((WITH_REC)) && [[ -d $DATA/recordings ]]; then ln -s "$DATA/recordings" "$work/recordings"; fi
tar -C "$work" -chzf "$OUT/echosentinel-$stamp.tar.gz" .
chmod 600 "$OUT/echosentinel-$stamp.tar.gz"
echo "Backup written: $OUT/echosentinel-$stamp.tar.gz (contains ES_SECRET_KEY — store securely)"

#!/usr/bin/env bash
set -euo pipefail
umask 077
backup_dir=${1:?Usage: bash scripts/backup.sh /private/backup-directory}
if docker compose ps --status running --services | grep -Eq '^(web|worker)$'; then
  printf 'Stop web and worker before capturing a consistent SQL/media pair.\n' >&2
  exit 1
fi
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres pg_dump -U intake -d intake --clean --if-exists --no-owner | gzip > "$backup_dir/sql-$stamp.sql.gz"
docker compose run --rm -T --no-deps --entrypoint tar web -czf - -C /data/media . > "$backup_dir/media-$stamp.tar.gz"
printf 'Backup pair saved with timestamp %s. Verify checksums and rehearse restore.\n' "$stamp"

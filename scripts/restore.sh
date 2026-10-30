#!/usr/bin/env bash
set -euo pipefail
sql_file=${1:?Usage: bash scripts/restore.sh sql.sql.gz media.tar.gz}
media_file=${2:?Matching media archive is required}
gzip -t "$sql_file"
tar -tzf "$media_file" >/dev/null
# Restore only operator-created backups into a stopped rehearsal/fresh target.
docker compose stop web worker
docker compose run --rm -T migrate
gunzip -c "$sql_file" | docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 --single-transaction -U intake -d intake
docker compose run --rm -T --no-deps --entrypoint tar web -xzf - -C /data/media < "$media_file"
docker compose up -d web worker

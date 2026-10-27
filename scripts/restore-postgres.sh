#!/usr/bin/env bash
# Replace the production database with a backup created by backup-postgres.sh.
# Usage: bash scripts/restore-postgres.sh backups/vibecheck-YYYYMMDDTHHMMSSZ.dump --yes
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.prod.yml)

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: bash scripts/restore-postgres.sh backups/vibecheck-YYYYMMDDTHHMMSSZ.dump --yes" >&2
  exit 1
fi

dump="$1"
confirm="${2:-}"
if [[ "$confirm" != "--yes" ]]; then
  echo "This replaces every row in the production database with the contents of the dump." >&2
  echo "Run it again with --yes when you mean it:" >&2
  echo "  bash scripts/restore-postgres.sh ${dump} --yes" >&2
  exit 1
fi

if [[ ! -f "$dump" ]]; then
  echo "Backup file not found. Pass the path under ./backups." >&2
  exit 1
fi

python3 - "$dump" <<'PY'
import sys
with open(sys.argv[1], "rb") as handle:
    magic = handle.read(5)
if magic != b"PGDMP":
    sys.exit(1)
PY

read_env() {
  awk -v key="$1" '
    {
      line = $0
      sub(/\r$/, "", line)
      sub(/^[[:space:]]+/, "", line)
      sub(/^export[[:space:]]+/, "", line)
    }
    line ~ "^" key "=" {
      sub(/^[^=]*=/, "", line)
      if (line ~ /^".*"$/ || line ~ /^'\''.*'\''$/) {
        line = substr(line, 2, length(line) - 2)
      }
      val = line
    }
    END { printf "%s", val }
  ' .env
}

db_user="$(read_env POSTGRES_USER)"
db_name="$(read_env POSTGRES_DB)"
if ! printf '%s' "$db_user" | grep -Eq '^[A-Za-z][A-Za-z0-9_]{0,62}$'; then
  echo "POSTGRES_USER is missing or not a plain identifier." >&2
  exit 1
fi
if ! printf '%s' "$db_name" | grep -Eq '^[A-Za-z][A-Za-z0-9_]{0,62}$'; then
  echo "POSTGRES_DB is missing or not a plain identifier." >&2
  exit 1
fi

echo "Stopping web, worker, and the reverse proxy. Postgres stays up."
"${COMPOSE[@]}" stop web worker caddy || true

"${COMPOSE[@]}" exec -T postgres psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db_name}' AND pid <> pg_backend_pid();" \
  >/dev/null
"${COMPOSE[@]}" exec -T postgres dropdb -U "$db_user" --if-exists "$db_name"
"${COMPOSE[@]}" exec -T postgres createdb -U "$db_user" -O "$db_user" "$db_name"
"${COMPOSE[@]}" exec -T postgres pg_restore -U "$db_user" -d "$db_name" --no-owner --no-acl < "$dump"

echo "Database restored. Starting the stack."
"${COMPOSE[@]}" up -d
echo "Restore finished from ${dump}"

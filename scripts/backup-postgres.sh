#!/usr/bin/env bash
# Nightly logical backup of the production Postgres volume. Rotates old dumps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE=(docker compose -f docker-compose.prod.yml)

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

if [[ ! -f .env ]]; then
  echo "Missing .env. Nothing was backed up." >&2
  exit 1
fi

db_user="$(read_env POSTGRES_USER)"
db_name="$(read_env POSTGRES_DB)"
days="$(read_env BACKUP_RETENTION_DAYS)"
[[ -n "$days" ]] || days=14

if ! printf '%s' "$db_user" | grep -Eq '^[A-Za-z][A-Za-z0-9_]{0,62}$'; then
  echo "POSTGRES_USER is missing or not a plain identifier. Backup stopped." >&2
  exit 1
fi
if ! printf '%s' "$db_name" | grep -Eq '^[A-Za-z][A-Za-z0-9_]{0,62}$'; then
  echo "POSTGRES_DB is missing or not a plain identifier. Backup stopped." >&2
  exit 1
fi
if ! printf '%s' "$days" | grep -Eq '^[1-9][0-9]{0,3}$'; then
  echo "BACKUP_RETENTION_DAYS must be a positive number of days. Backup stopped." >&2
  exit 1
fi

mkdir -p backups
chmod 700 backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="backups/vibecheck-${stamp}.dump"
tmp="${out}.partial"
rm -f "$tmp"
trap 'rm -f "$tmp"' ERR

"${COMPOSE[@]}" exec -T postgres pg_dump -U "$db_user" -d "$db_name" -Fc --no-owner --no-acl > "$tmp"

python3 - "$tmp" <<'PY'
import sys
with open(sys.argv[1], "rb") as handle:
    magic = handle.read(5)
if magic != b"PGDMP":
    sys.exit(1)
PY

mv "$tmp" "$out"
chmod 600 "$out"
trap - ERR

find backups -type f -name 'vibecheck-*.dump' -mtime "+${days}" -delete
echo "Backup written to ${out}"

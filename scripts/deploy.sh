#!/usr/bin/env bash
# One-command update: git pull, then rebuild and start the production stack.
set -euo pipefail

# mkswap reports a little less than the file size: a 4G file is about 4095 MB,
# and a 2G file is about 2047 MB. 3900 and 1900 accept those files.
swap_file_to_add() {
  local mem_mb="$1"
  local swap_mb="$2"
  if [[ "$mem_mb" -lt 3000 && "$swap_mb" -lt 3900 ]]; then
    printf '4 GB\n'
  elif [[ "$mem_mb" -lt 6000 && "$swap_mb" -lt 1900 ]]; then
    printf '2 GB\n'
  fi
}

main() {
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Follow docs/DEPLOY_SELF_HOSTED.md." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "This user cannot talk to Docker. Run: sudo usermod -aG docker \"\$USER\"" >&2
  echo "Then close SSH and connect again. Do not run this script with sudo." >&2
  exit 1
fi

bash scripts/check-prod-env.sh

mem_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
swap_mb="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
needed="$(swap_file_to_add "$mem_mb" "$swap_mb")"
if [[ -n "$needed" ]]; then
  echo "This VM has ${mem_mb} MB of RAM. Add a ${needed} swap file before the first build." >&2
  echo "The commands are in docs/DEPLOY_SELF_HOSTED.md." >&2
  exit 1
fi

if [[ -d .git ]]; then
  git pull --ff-only
else
  echo "This folder is not a git checkout. Skipping git pull." >&2
fi

mkdir -p backups
chmod 700 backups

export COMPOSE_PARALLEL_LIMIT=1
docker compose -f docker-compose.prod.yml up -d --build

install_backup_cron() {
  local line current
  line="15 3 * * * cd ${ROOT} && /usr/bin/flock -n ${ROOT}/backups/backup.lock /usr/bin/env bash scripts/backup-postgres.sh >> ${ROOT}/backups/backup.log 2>&1"
  if ! command -v crontab >/dev/null 2>&1; then
    echo "cron is not installed, so nightly backups are not scheduled. Install cron, then run this script again." >&2
    echo "Until then you can run: bash scripts/backup-postgres.sh" >&2
    return 0
  fi
  current="$(crontab -l 2>/dev/null || true)"
  if printf '%s\n' "$current" | grep -F "scripts/backup-postgres.sh" >/dev/null 2>&1; then
    echo "Nightly backup cron is already installed."
    return 0
  fi
  printf '%s\n%s\n' "$current" "$line" | crontab -
  echo "Installed a nightly backup at 03:15 UTC. Dumps stay in ./backups."
}

install_backup_cron

site="$(awk -F= '/^SITE_ADDRESS=/ { value=$2 } END { print value }' .env | tr -d '"\r')"
echo "Stack is starting. When DNS and HTTPS are ready, open https://${site}/api/health"
echo "Expect {\"ok\":true}. The first certificate can take a few minutes."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

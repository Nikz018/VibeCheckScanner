#!/usr/bin/env bash
# Cursor cloud Start Script. Idempotent: a second run leaves running services alone and exits 0.
# Copy .env.example when needed, start local Postgres and Redis, push the schema, then
# start the demo targets, web app, and worker in tmux. No production secrets belong here.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

load_env() {
  local line key value
  [[ -f .env ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *"="* ]] || continue
    key="${line%%=*}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    if [[ ${#value} -ge 2 && "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ ${#value} -ge 2 && "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done < .env
}

if [[ "${1:-}" == "--exec" ]]; then
  shift
  load_env
  exec "$@"
fi

log() { printf '%s\n' "$*"; }

if [[ ! -f .env ]]; then
  cp .env.example .env
  log "Created .env from .env.example"
else
  log ".env already present"
fi
load_env

if ! command -v pg_isready >/dev/null 2>&1 || ! command -v redis-cli >/dev/null 2>&1; then
  log "PostgreSQL 16 and Redis 7 must already be installed."
  exit 1
fi

if pg_isready -q 2>/dev/null; then
  log "PostgreSQL already accepting connections"
else
  log "Starting PostgreSQL"
  sudo pg_ctlcluster 16 main start \
    || sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -l /tmp/pg.log start
fi

if timeout 5 redis-cli ping 2>/dev/null | grep -q PONG; then
  log "Redis already accepting connections"
else
  log "Starting Redis"
  if ! sudo service redis-server start; then
    sudo redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --protected-mode yes --logfile /tmp/redis.log --dir /tmp
  fi
fi

postgres_ready=0
for _ in $(seq 1 30); do
  if pg_isready -q 2>/dev/null; then
    postgres_ready=1
    break
  fi
  sleep 1
done
[[ "$postgres_ready" == 1 ]] || { log "PostgreSQL did not become ready"; exit 1; }

redis_ready=0
for _ in $(seq 1 30); do
  if timeout 5 redis-cli ping 2>/dev/null | grep -q PONG; then
    redis_ready=1
    break
  fi
  sleep 1
done
[[ "$redis_ready" == 1 ]] || { log "Redis did not become ready"; exit 1; }

# Create the local role and database named by DATABASE_URL when they are missing.
# The password comes from .env, which is gitignored. Identifiers are restricted to plain names.
if [[ "${DATABASE_URL:-}" == postgresql://* || "${DATABASE_URL:-}" == postgres://* ]]; then
  url_rest="${DATABASE_URL#*://}"
  url_userpass="${url_rest%%@*}"
  db_user="${url_userpass%%:*}"
  db_pass="${url_userpass#*:}"
  url_db="${url_rest##*/}"
  db_name="${url_db%%\?*}"
  if [[ "$db_user" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    db_pass_sql="${db_pass//\'/\'\'}"
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${db_user}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L SUPERUSER', '${db_user}', '${db_pass_sql}');
  END IF;
END
\$\$;
SELECT format('CREATE DATABASE %I OWNER %I', '${db_name}', '${db_user}')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db_name}')\\gexec
SQL
  else
    log "DATABASE_URL user or database name is not a plain identifier; skipped role setup"
  fi
fi

schema_ready=0
for _ in $(seq 1 5); do
  if timeout 60 npx prisma db push; then
    schema_ready=1
    break
  fi
  log "prisma db push failed; retrying"
  sleep 3
done
[[ "$schema_ready" == 1 ]] || { log "prisma db push did not succeed"; exit 1; }

if [[ -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
else
  TMUX=(tmux)
fi

start_session() {
  local name="$1"
  local logfile="$2"
  shift 2
  if "${TMUX[@]}" has-session -t "$name" 2>/dev/null; then
    log "$name already running"
    return 0
  fi
  : > "$logfile"
  local cmd="bash scripts/dev-start.sh --exec"
  local arg
  for arg in "$@"; do
    cmd+=" $(printf '%q' "$arg")"
  done
  cmd+=" >> $(printf '%q' "$logfile") 2>&1"
  "${TMUX[@]}" new-session -d -s "$name" -c "$ROOT" "$cmd"
  log "started $name"
}

start_session vibecheck-demos /tmp/vibecheck-demos.log npm run demos
start_session vibecheck-web /tmp/vibecheck-web.log npm run dev -- -H 127.0.0.1 -p 3000
start_session vibecheck-worker /tmp/vibecheck-worker.log npm run worker

app_ready=0
for _ in $(seq 1 40); do
  if timeout 5 curl -sf -o /dev/null "http://127.0.0.1:3000/api/health" \
    && timeout 3 curl -sf -o /dev/null "http://127.0.0.1:4010/" \
    && timeout 3 curl -sf -o /dev/null "http://127.0.0.1:4011/" \
    && timeout 3 curl -sf -o /dev/null "http://127.0.0.1:4012/" \
    && timeout 3 curl -sf -o /dev/null "http://127.0.0.1:4013/"; then
    app_ready=1
    break
  fi
  sleep 3
done
if [[ "$app_ready" != 1 ]]; then
  log "web or demo targets did not become ready"
  tail -n 40 /tmp/vibecheck-web.log >&2 || true
  tail -n 20 /tmp/vibecheck-demos.log >&2 || true
  exit 1
fi

log "VibeCheck dev environment is up"
exit 0

#!/usr/bin/env bash
# Reproduce the VibeCheck scan flow on the host, without Docker.
# Installs PostgreSQL and Redis when they are missing, pushes the Prisma schema,
# starts the demo target, web app, and worker, then signs in and runs a scan.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

log() { printf '\n== %s\n' "$*"; }

if ! command -v psql >/dev/null 2>&1 || ! command -v redis-server >/dev/null 2>&1; then
  log "Installing PostgreSQL and Redis"
  timeout 300 sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
  timeout 300 sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib redis-server
fi

if ! pg_isready -q 2>/dev/null; then
  log "Starting PostgreSQL"
  sudo pg_ctlcluster 16 main start || sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -l /tmp/pg.log start
fi
if ! timeout 5 redis-cli ping >/dev/null 2>&1; then
  log "Starting Redis"
  sudo redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --protected-mode yes --logfile /tmp/redis.log --dir /tmp
fi
timeout 10 redis-cli ping | grep -q PONG

log "Ensuring the vibecheck database"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vibecheck') THEN
    CREATE ROLE vibecheck LOGIN PASSWORD 'vibecheck' SUPERUSER;
  END IF;
END
$$;
SELECT 'CREATE DATABASE vibecheck OWNER vibecheck'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vibecheck')\gexec
SQL

cat > .env <<'EOF'
APP_URL=http://127.0.0.1:3000
SESSION_SECRET=e2e-local-secret
DEV_EXPOSE_MAGIC_LINK=true
ALLOW_LOCAL_TARGETS=true
LOCALHOST_REWRITE_HOST=
DATABASE_URL=postgresql://vibecheck:vibecheck@127.0.0.1:5432/vibecheck
REDIS_URL=redis://127.0.0.1:6379
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=scans@localhost
PAYMENT_PROVIDER=dodo
DODO_PAYMENTS_API_KEY=
DODO_WEBHOOK_SECRET=
DODO_ENV=test_mode
DODO_PRODUCT_REPORT=pdt_0NqUPK77rA0fd1CknGv8C
DODO_PRODUCT_RESCAN=pdt_0NqUQCBmdARxCAyoaIRVZ
DODO_PRODUCT_MONITOR=pdt_0NqUQeUgIBSIizoXIrkrJ
STRIPE_SECRET_KEY=sk_test_local_fixture_not_a_real_key
STRIPE_WEBHOOK_SECRET=whsec_local_fixture_not_from_stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_PRICE_REPORT=
STRIPE_PRICE_RESCAN=
STRIPE_PRICE_MONITOR=
PLAYWRIGHT_ENABLED=true
PLAYWRIGHT_CHANNEL=chrome
BROWSER_TIMEOUT_MS=20000
MONITOR_INTERVAL_HOURS=24
BADGE_STALE_DAYS=30
CREDENTIALS_ENCRYPTION_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
EOF

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ ! -d node_modules ]]; then
  log "Installing npm dependencies"
  timeout 180 npm install
fi

log "Pushing Prisma schema"
timeout 120 npx prisma db push

log "Webhook signature and tier unlock"
timeout 120 node --import tsx --test --test-reporter spec src/lib/stripe-webhook.test.ts

WEB_PID=""
WORKER_PID=""
DEMO_PID=""
cleanup() {
  local ec=$?
  trap - EXIT
  if [[ -n "$WEB_PID" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
  if [[ -n "$WORKER_PID" ]]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  if [[ -n "$DEMO_PID" ]]; then kill "$DEMO_PID" 2>/dev/null || true; fi
  pkill -f "next dev -H 127.0.0.1 -p 3000" >/dev/null 2>&1 || true
  pkill -f "src/worker/index.ts" >/dev/null 2>&1 || true
  if [[ -n "$DEMO_PID" ]]; then pkill -f "demo-targets/open-backend/server.js" >/dev/null 2>&1 || true; fi
  sleep 1
  if [[ -n "$WEB_PID" ]]; then kill -9 "$WEB_PID" 2>/dev/null || true; fi
  if [[ -n "$WORKER_PID" ]]; then kill -9 "$WORKER_PID" 2>/dev/null || true; fi
  if [[ -n "$DEMO_PID" ]]; then kill -9 "$DEMO_PID" 2>/dev/null || true; fi
  exit "$ec"
}
trap cleanup EXIT

free_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
  local pids
  pids="$(netstat -lptn 2>/dev/null | awk -v port="$port" '$4 ~ (":" port "$") { split($7, a, "/"); if (a[1] ~ /^[0-9]+$/) print a[1] }')"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

if timeout 2 curl -sf -o /dev/null "http://127.0.0.1:4010/" ; then
  log "Demo target already listening on 4010"
else
  log "Starting open-backend demo"
  PORT=4010 node demo-targets/open-backend/server.js > /tmp/vibecheck-demo.log 2>&1 &
  DEMO_PID=$!
fi

log "Stopping leftover web and worker processes"
pkill -f "src/worker/index.ts" >/dev/null 2>&1 || true
pkill -f "next dev -H 127.0.0.1 -p 3000" >/dev/null 2>&1 || true
sleep 1

log "Freeing port 3000"
free_port 3000
sleep 1
if timeout 2 curl -sf -o /dev/null "http://127.0.0.1:3000/api/health"; then
  echo "port 3000 is still serving traffic" >&2
  exit 1
fi

log "Starting web and worker"
LINEBUF=""
if command -v stdbuf >/dev/null 2>&1; then LINEBUF="stdbuf -oL -eL"; fi
# shellcheck disable=SC2086
$LINEBUF npx next dev -H 127.0.0.1 -p 3000 > /tmp/vibecheck-web.log 2>&1 &
WEB_PID=$!
# shellcheck disable=SC2086
$LINEBUF npx tsx src/worker/index.ts > /tmp/vibecheck-worker.log 2>&1 &
WORKER_PID=$!

ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "web process exited early" >&2
    tail -n 80 /tmp/vibecheck-web.log >&2 || true
    exit 1
  fi
  if grep -q EADDRINUSE /tmp/vibecheck-web.log; then
    echo "web failed to bind port 3000" >&2
    exit 1
  fi
  if timeout 5 curl -sf -o /dev/null "http://127.0.0.1:3000/api/health" \
    && timeout 2 curl -sf -o /dev/null "http://127.0.0.1:4010/" \
    && grep -q "Ready" /tmp/vibecheck-web.log; then
    ready=1
    break
  fi
  sleep 3
done
if [[ "$ready" != 1 ]]; then
  echo "web or demo did not become ready" >&2
  tail -n 80 /tmp/vibecheck-web.log >&2 || true
  exit 1
fi

worker_ready=0
for _ in $(seq 1 20); do
  if grep -q "worker ready" /tmp/vibecheck-worker.log; then
    worker_ready=1
    break
  fi
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "worker process exited early" >&2
    tail -n 80 /tmp/vibecheck-worker.log >&2 || true
    exit 1
  fi
  sleep 1
done
if [[ "$worker_ready" != 1 ]]; then
  echo "worker did not become ready" >&2
  tail -n 80 /tmp/vibecheck-worker.log >&2 || true
  exit 1
fi

log "Running the signed-in scan flow"
export E2E_WORKER_LOG=/tmp/vibecheck-worker.log
export E2E_EMAIL="e2e-local-$(date +%s)@example.com"
timeout 200 npx tsx scripts/e2e-flow.ts

log "Local flow finished"

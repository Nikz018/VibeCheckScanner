#!/bin/sh
set -e
attempt=0
until npx prisma db push --skip-generate; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "database did not become reachable" >&2
    exit 1
  fi
  echo "waiting for the database"
  sleep 2
done
exec npx tsx src/worker/index.ts

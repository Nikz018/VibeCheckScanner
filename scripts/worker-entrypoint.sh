#!/bin/sh
set -e
npx prisma db push --skip-generate
exec npx tsx src/worker/index.ts

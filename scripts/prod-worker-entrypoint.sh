#!/bin/sh
set -eu
sh scripts/prisma-deploy.sh
exec npx tsx src/worker/index.ts

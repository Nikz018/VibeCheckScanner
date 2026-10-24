#!/usr/bin/env bash
# Cursor cloud Install Script. Installs lockfile dependencies and generates the Prisma client.
# Safe to run again. Does not start servers and does not read or write secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npx prisma generate

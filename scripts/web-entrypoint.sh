#!/bin/sh
set -e
npx prisma db push --skip-generate
exec npx next start -H 0.0.0.0 -p 3000

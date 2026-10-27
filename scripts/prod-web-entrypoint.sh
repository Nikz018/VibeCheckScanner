#!/bin/sh
set -eu
sh scripts/prisma-deploy.sh
exec npx next start -H 0.0.0.0 -p 3000

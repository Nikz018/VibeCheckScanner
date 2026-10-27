#!/bin/sh
# Apply committed Prisma migrations, then confirm ScanCredential exists.
# Safe to run from more than one container: migrate deploy takes a lock.
set -eu

redact() {
  sed -E 's#postgres(ql)?://[^[:space:]]+#postgresql://[redacted]#g'
}

attempt=0
until output=$(npx prisma migrate deploy 2>&1); do
  attempt=$((attempt + 1))
  printf '%s\n' "$output" | redact >&2
  if [ "$attempt" -ge 30 ]; then
    echo "database did not accept migrations" >&2
    exit 1
  fi
  echo "waiting for the database" >&2
  sleep 2
done
printf '%s\n' "$output" | redact

node <<'NODE'
const { PrismaClient } = require("@prisma/client");

function redact(message) {
  return String(message).replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

const prisma = new PrismaClient();
prisma
  .$queryRawUnsafe(`SELECT to_regclass('"ScanCredential"')::text AS name`)
  .then((rows) => {
    const name = rows && rows[0] && rows[0].name;
    if (!name) {
      console.error("ScanCredential table is missing after prisma migrate deploy");
      process.exit(1);
    }
    return prisma.$disconnect().then(() => process.exit(0));
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : "schema check failed";
    console.error(redact(message));
    process.exit(1);
  });
NODE

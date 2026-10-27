#!/usr/bin/env bash
# Checks the swap gate and that locally built images are not pulled.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/deploy.sh"

failures=0

expect_swap() {
  local mem_mb="$1"
  local swap_mb="$2"
  local expected="$3"
  local got
  got="$(swap_file_to_add "$mem_mb" "$swap_mb")"
  if [[ "$got" != "$expected" ]]; then
    echo "mem ${mem_mb} swap ${swap_mb}: expected '${expected}', got '${got}'" >&2
    failures=$((failures + 1))
  fi
}

# A 4G swap file reports about 4095 MB. A 2 GB VM must accept that.
expect_swap 1834 4095 ""
expect_swap 1834 3900 ""
expect_swap 1834 3899 "4 GB"
expect_swap 1834 2047 "4 GB"
expect_swap 1834 0 "4 GB"

# A 2G swap file reports about 2047 MB. A 4 GB VM must accept that.
expect_swap 3900 2047 ""
expect_swap 3999 1900 ""
expect_swap 3999 1899 "2 GB"
expect_swap 5999 1899 "2 GB"
expect_swap 5999 1900 ""

# 6 GB and up does not require swap.
expect_swap 6000 0 ""
expect_swap 7000 0 ""

config="$(mktemp)"
empty_env="$(mktemp)"
trap 'rm -f "$config" "$empty_env"' EXIT
POSTGRES_USER=vibecheck \
POSTGRES_PASSWORD=local-test-password \
POSTGRES_DB=vibecheck \
APP_URL=https://scan.example \
NEXT_PUBLIC_SITE_URL=https://scan.example \
SITE_ADDRESS=scan.example \
ACME_EMAIL=certs@scan.example \
docker compose --env-file "$empty_env" -f "$ROOT/docker-compose.prod.yml" --project-directory "$ROOT" config --format json > "$config"

python3 - "$config" <<'PY'
import json
import sys

doc = json.load(open(sys.argv[1], encoding="utf-8"))
services = doc["services"]
expected = {
    "migrate": "build",
    "web": "build",
    "worker": "never",
}
for name, policy in expected.items():
    got = services[name].get("pull_policy")
    if got != policy:
        raise SystemExit(f"{name} pull_policy is {got!r}, expected {policy!r}")
for name in ("postgres", "redis", "caddy"):
    if services[name].get("pull_policy") == "build":
        raise SystemExit(f"{name} is a registry image and must stay pullable")
print("pull_policy migrate=build web=build worker=never")
PY

if [[ "$failures" -ne 0 ]]; then
  echo "${failures} swap check(s) failed" >&2
  exit 1
fi

echo "swap thresholds accepted a 4095 MB SwapTotal on a 1834 MB VM"

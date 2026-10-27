#!/usr/bin/env bash
# Check .env for a production deploy. Prints variable names, never values.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env. Copy .env.example to .env and fill it in. See docs/DEPLOY_SELF_HOSTED.md." >&2
  exit 1
fi

read_env() {
  awk -v key="$1" '
    {
      line = $0
      sub(/\r$/, "", line)
      sub(/^[[:space:]]+/, "", line)
      sub(/^export[[:space:]]+/, "", line)
    }
    line ~ "^" key "=" {
      sub(/^[^=]*=/, "", line)
      if (line ~ /^".*"$/ || line ~ /^'\''.*'\''$/) {
        line = substr(line, 2, length(line) - 2)
      }
      val = line
    }
    END { printf "%s", val }
  ' "$ENV_FILE"
}

require_nonempty() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "${name} is empty. Set it in .env." >&2
    exit 1
  fi
}

site="$(read_env SITE_ADDRESS)"
email="$(read_env ACME_EMAIL)"
db_user="$(read_env POSTGRES_USER)"
db_name="$(read_env POSTGRES_DB)"
db_pass="$(read_env POSTGRES_PASSWORD)"
session="$(read_env SESSION_SECRET)"
app_url="$(read_env APP_URL)"
public_url="$(read_env NEXT_PUBLIC_SITE_URL)"
cred_key="$(read_env CREDENTIALS_ENCRYPTION_KEY)"

require_nonempty SITE_ADDRESS "$site"
require_nonempty ACME_EMAIL "$email"
require_nonempty POSTGRES_USER "$db_user"
require_nonempty POSTGRES_DB "$db_name"
require_nonempty POSTGRES_PASSWORD "$db_pass"
require_nonempty SESSION_SECRET "$session"
require_nonempty APP_URL "$app_url"
require_nonempty NEXT_PUBLIC_SITE_URL "$public_url"
require_nonempty CREDENTIALS_ENCRYPTION_KEY "$cred_key"

if [[ "$site" == *"://"* || "$site" == */* || "$site" != *.* ]]; then
  echo "SITE_ADDRESS must be a bare hostname such as scan.example.com, with no https:// and no path." >&2
  exit 1
fi

if [[ "$email" != *@* || "$email" == *@ || "$email" == @* ]]; then
  echo "ACME_EMAIL must be an email address Let's Encrypt can use for expiry notices." >&2
  exit 1
fi

if ! printf '%s' "$db_user" | grep -Eq '^[A-Za-z][A-Za-z0-9_]{0,62}$'; then
  echo "POSTGRES_USER must be letters, numbers, and underscores, starting with a letter." >&2
  exit 1
fi

if ! printf '%s' "$db_name" | grep -Eq '^[A-Za-z][A-Za-z0-9_]{0,62}$'; then
  echo "POSTGRES_DB must be letters, numbers, and underscores, starting with a letter." >&2
  exit 1
fi

if ! printf '%s' "$db_pass" | grep -Eq '^[A-Za-z0-9]{16,}$'; then
  echo "POSTGRES_PASSWORD must be at least 16 letters and numbers, with no symbols, so it is safe inside DATABASE_URL." >&2
  echo "Generate one with: openssl rand -hex 32" >&2
  exit 1
fi

if [[ "$db_pass" == "vibecheck" || "$db_pass" == "password" || "$db_pass" == "changeme" ]]; then
  echo "POSTGRES_PASSWORD is still a placeholder. Generate a new one with: openssl rand -hex 32" >&2
  exit 1
fi

if [[ ${#session} -lt 32 ]]; then
  echo "SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32" >&2
  exit 1
fi

case "$session" in
  replace-with-a-long-random-string|dev-only-change-me|changeme|change-me)
    echo "SESSION_SECRET is still the example placeholder. Generate one with: openssl rand -hex 32" >&2
    exit 1
    ;;
esac

if [[ "$app_url" != "https://${site}" ]]; then
  echo "APP_URL must be exactly https://${site} with no trailing slash." >&2
  exit 1
fi

if [[ "$public_url" != "$app_url" ]]; then
  echo "NEXT_PUBLIC_SITE_URL must match APP_URL exactly (https://${site}, no trailing slash)." >&2
  echo "Changing it requires another deploy so the web image rebuilds." >&2
  exit 1
fi

key_file="$(mktemp)"
chmod 600 "$key_file"
trap 'rm -f "$key_file"' EXIT
printf '%s' "$cred_key" > "$key_file"
if ! python3 - "$key_file" <<'PY'
import base64, re, sys
raw = open(sys.argv[1], "r", encoding="utf-8").read().strip()
if re.fullmatch(r"[0-9a-fA-F]{64}", raw):
    sys.exit(0)
try:
    padded = raw + "=" * ((4 - len(raw) % 4) % 4)
    decoded = base64.b64decode(padded, validate=True)
except Exception:
    sys.exit(1)
sys.exit(0 if len(decoded) == 32 else 1)
PY
then
  echo "CREDENTIALS_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, or standard base64." >&2
  echo "Generate one with: openssl rand -hex 32" >&2
  exit 1
fi
rm -f "$key_file"
trap - EXIT

smtp_host="$(read_env SMTP_HOST)"
if [[ -z "$smtp_host" ]]; then
  echo "Warning: SMTP_HOST is empty. The site can start, but magic links are not emailed, so nobody can sign in until SMTP is set." >&2
fi

dodo_key="$(read_env DODO_PAYMENTS_API_KEY)"
dodo_secret="$(read_env DODO_WEBHOOK_SECRET)"
if [[ -z "$dodo_key" || -z "$dodo_secret" ]]; then
  echo "Warning: Dodo checkout is not configured yet. Webhook URL when you are ready: https://${site}/api/dodo/webhook" >&2
else
  echo "Dodo webhook URL: https://${site}/api/dodo/webhook" >&2
fi

echo "Production env checks passed for https://${site}."

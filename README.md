# VibeCheck

VibeCheck is a point-in-time security report for indie builders shipping apps from Lovable, Bolt, Supabase, Firebase, and similar tools. You prove you own the origin, consent to a non-destructive scan, and get findings with evidence, impact, and a fix you can paste.

Customer-facing reports never name the libraries used to collect evidence. They show the finding, not the tool.

This is not a certification, and it is not a promise that an app stays safe after the scan date.

## What you get

| Tier | Price | Unlocks |
| --- | --- | --- |
| Free teaser | $0 | Full scan runs and is stored. The page shows the score, severity counts, family coverage, and two sample issues. The rest of the evidence stays locked. |
| Full report | $49 once, plus applicable taxes | Every finding on that scan: where it was found, evidence, the request and response, and a copy-paste fix. Download a PDF or a Markdown file for an AI coding assistant. |
| Report + rescan | $99 once, plus applicable taxes | The full report, plus one credit to run another full-access scan after you fix things. |
| Monitoring | $29/month, plus applicable taxes | Full reports while the subscription is active, a scheduled rescan of a verified origin, and an alert when a new high-severity issue appears. |

The mini check is separate and free. It only runs header and public-file checks, and the coverage summary marks every other family as not run.

A finished scan can opt into a public score page and an SVG badge. Those show the score out of 100 and the scan date. They do not show findings. After 30 days they read **rescan needed**.

Score starts at 100. Critical findings subtract 25, high 12, medium 6, low 2. Reports show the result as a score out of 100: 0–39 Critical risk, 40–69 Needs work, 70–89 Good, and 90–100 Strong.

## Local setup

Prerequisites: Docker with Compose, or Node 22 plus Postgres 16 and Redis 7 if you prefer not to containerize the app.

```bash
cp .env.example .env
docker compose up --build
```

Then open http://localhost:3000.

The first build installs dependencies and, for the worker image, a headless browser. That image is large. The web process does not launch a browser.

Demo targets (intentionally insecure, local only):

- http://127.0.0.1:4010 open backend
- http://127.0.0.1:4011 client paywall
- http://127.0.0.1:4012 missing headers and public files
- http://127.0.0.1:4013 signed-in IDOR, admin, and paywall bugs (local only)

See [demo-targets/README.md](demo-targets/README.md). Do not deploy those processes.

Sign in with any email. With `DEV_EXPOSE_MAGIC_LINK=true` the login screen prints the link so you do not need SMTP.

### Without Docker

`scripts/e2e-local.sh` installs PostgreSQL and Redis with apt when they are missing, creates the `vibecheck` database, writes a gitignored `.env`, pushes the Prisma schema, and runs the signed-in flow against the open-backend demo: magic link, ownership file, consent, queued scan, free teaser, a signed Stripe fixture that unlocks the report, the share toggle, and the SVG badge.

```bash
bash scripts/e2e-local.sh
```

To start the same processes yourself:

```bash
cp .env.example .env
# point DATABASE_URL and REDIS_URL at local Postgres and Redis
npm install
npx prisma db push
npm run demos
npm run dev
npm run worker
```

Leave `LOCALHOST_REWRITE_HOST` empty when the app runs on the host. Inside Compose it is `host.docker.internal` so the containers can reach demo ports published on the host.

Set `PLAYWRIGHT_CHANNEL=chrome` to launch the system Chrome instead of Playwright's downloaded browser. `BROWSER_TIMEOUT_MS` (default 20000) kills that browser if it exceeds the budget. The scan still finishes from the pages it already fetched, and the report does not mention the browser.

`npm test` does not need Postgres or Redis except for `src/lib/stripe-webhook.test.ts` and `src/lib/payments/dodo-webhook.test.ts`, which skip the database cases unless `DATABASE_URL` is set. The rest checks the catalog, the report sanitizer, scoring, badge freshness, the Dodo checkout payload, and a scan of the three demo targets.

### Cursor cloud environment

The image should already have Node 22, PostgreSQL 16, and Redis 7. Paste these into the environment settings. Install runs when the environment is built. Start runs on every boot and can be run again without starting a second copy of the app.

Install Script:

```bash
bash scripts/dev-install.sh
```

Start Script:

```bash
bash scripts/dev-start.sh
```

`dev-install.sh` runs `npm ci` and `npx prisma generate`. `dev-start.sh` copies `.env.example` to `.env` only when `.env` is missing, starts PostgreSQL and Redis when they are down, pushes the Prisma schema, and opens tmux sessions `vibecheck-demos`, `vibecheck-web`, and `vibecheck-worker`. It waits until http://127.0.0.1:3000/api/health returns 200, prints `VibeCheck dev environment is up`, and exits 0. These scripts do not contain production secrets. Put Dodo or Stripe keys in the environment secret store or in the gitignored `.env` after the copy.

## Ownership proof

Active probes do not start until both of these are true:

1. The account checks the consent box.
2. The origin serves the one-time token, either as DNS TXT or as a file.

Create a scan and copy the token (`vc_` plus 32 hex characters).

**DNS TXT.** On the hostname, publish a TXT record whose value is the token. `_vibecheck.example.com` is also accepted.

**Well-known file.** Serve the token as the entire body of:

```text
https://your-origin/.well-known/vibecheck-verify.txt
```

The worker checks the proof again when the job starts. If you remove it, the scan stops before any probe. Local demo apps keep the token in memory. The scan form can install it for ports 4010–4013 when `ALLOW_LOCAL_TARGETS=true`.

## Signed-in checks

The $49 and $99 reports, and an active monitoring subscription, can scan behind a login. The free teaser does not. On the scan form, add up to two throwaway test accounts on the verified origin, or a session cookie or bearer token when the app uses 2FA or a social login. Use test accounts only.

Set `CREDENTIALS_ENCRYPTION_KEY` to 32 bytes, as 64 hex characters or standard base64, before those credentials can be stored. The API refuses the scan if the key is missing. The worker decrypts the values only for that scan, deletes them when the scan finishes (success or failure), and a cleanup pass deletes anything older than 24 hours. Reports, downloads, and the public score page do not include the password, cookie, or token.

Signed-in probes are GET and HEAD only, plus the login request itself. They do not submit other forms and they skip logout, delete, settings, and billing URLs. A failed login is a notice, not a scored finding, and the unauthenticated checks still run.

The worker allows only GET, HEAD, OPTIONS, and small POSTs. It does not send PUT, PATCH, or DELETE. It refuses link-local and metadata addresses, and it refuses private addresses except the verified origin when local targets are explicitly enabled. Supabase and Firebase hosts that appear in the public bundle may be read with the public client key. Service-role material is reported and redacted, not reused for writes.

Set `ALLOW_LOCAL_TARGETS=false` anywhere except a trusted dev machine.

## Scan coverage

The checklist in [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) is generated from `CHECK_CATALOG` in `src/lib/catalog.ts`. Every check maps to an OWASP Top 10 2021 category, an OWASP API Top 10 2023 category when it applies, an ASVS 4.0 chapter, a CWE, and one of these families:

- secrets
- cloud_backend
- access_control
- injection_xss
- auth_session
- transport_headers
- info_disclosure
- dependencies

Headline ranks 1–10 sort first in the report and choose the free teaser samples. They do not replace the rest of the catalog. A full scan attempts every family. A mini check does not, and it must not show those families as passed.

The headless render is optional. Set `PLAYWRIGHT_ENABLED=false` to use HTTP fetching only. Static bundles are still downloaded and reviewed. If the browser cannot launch, or if it runs longer than `BROWSER_TIMEOUT_MS`, the worker kills that browser process and the scan continues with the fetched files. The report does not mention the browser.

## Payments

`PAYMENT_PROVIDER` chooses who charges the card. Leave it unset, or set it to `dodo`, and checkout uses Dodo Payments. Set it to `stripe` to keep using Stripe. The plans stay $49, $99, and $29/month. The free teaser, unlock rules, and PDF or Markdown downloads do not change. A checkout uses the selected provider. The other provider's webhook still accepts events, so a payment that was already started can still unlock.

## Dodo Payments

Dodo is the default. Create a Dodo Payments account, switch the dashboard to test mode, and add three products. Do not commit secret keys. Live checkout can wait until the keys exist. The code is already set up for `DODO_ENV=test_mode`.

1. Open [Dodo Payments](https://app.dodopayments.com) and switch the dashboard to **Test mode**.
2. The test-mode product IDs are already filled in below. They are tax-exclusive: Dodo adds tax at checkout. A different Dodo account needs its own three products, then those IDs replace the defaults.
   - Full report: **$49** once. `pdt_0NqUPK77rA0fd1CknGv8C`
   - Report + rescan: **$99** once. `pdt_0NqUQCBmdARxCAyoaIRVZ`
   - Continuous monitoring: **$29** every month. `pdt_0NqUQeUgIBSIizoXIrkrJ`
3. Go to **Developer → API Keys**, create a key in test mode, and copy it. That value is `DODO_PAYMENTS_API_KEY`.
4. Go to **Developer → Webhooks** and add an endpoint. Copy that endpoint's signing secret. That value is `DODO_WEBHOOK_SECRET`.
   - On your laptop the app is `http://localhost:3000/api/dodo/webhook`. Dodo cannot reach localhost, so use a tunnel, or add the public URL after you deploy.
   - On the deployed app the URL is `https://<your-web-host>/api/dodo/webhook`.
5. Put the values in `.env`:

| Env | What to paste |
| --- | --- |
| `PAYMENT_PROVIDER` | `dodo` |
| `DODO_ENV` | `test_mode` until you charge real cards, then `live_mode` |
| `DODO_PAYMENTS_API_KEY` | The test API key |
| `DODO_WEBHOOK_SECRET` | The webhook signing secret |
| `DODO_PRODUCT_REPORT` | `pdt_0NqUPK77rA0fd1CknGv8C` ($49 once, tax-exclusive) |
| `DODO_PRODUCT_RESCAN` | `pdt_0NqUQCBmdARxCAyoaIRVZ` ($99 once, tax-exclusive) |
| `DODO_PRODUCT_MONITOR` | `pdt_0NqUQeUgIBSIizoXIrkrJ` ($29/month, tax-exclusive) |

The prices on the site are before tax. Dodo products are tax-exclusive, so tax is added on the checkout page. The upgrade form asks for a billing country and address, then sends the customer to that page. The webhook is `POST /api/dodo/webhook`. It checks the [Standard Webhooks](https://www.standardwebhooks.com/) signature. A missing or bad signature gets HTTP 400 and changes nothing. `payment.succeeded` unlocks the report (and adds the rescan credit on the $99 product). `payment.failed` does not unlock anything. `subscription.active` and `subscription.renewed` turn monitoring on. `subscription.cancelled` and `subscription.failed` turn it off. The same event id is applied once.

You do not need a Dodo account to run the tests. They mock checkout and sign a local webhook fixture. A real test-mode payment still needs the API key and the webhook secret. The three product IDs above are the defaults in `.env.example` and in the server when those variables are empty. Until `DODO_PAYMENTS_API_KEY` is set, pricing and upgrade buttons say that checkout is being set up.

## Stripe

Create three prices in Stripe test mode and paste the IDs into `.env`. Do not commit secret keys.

| Env | Product |
| --- | --- |
| `STRIPE_PRICE_REPORT` | $49 one-time |
| `STRIPE_PRICE_RESCAN` | $99 one-time |
| `STRIPE_PRICE_MONITOR` | $29/month |

Also set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

Checkout is a hosted Stripe Checkout session. The webhook is `POST /api/stripe/webhook`. For local delivery:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Put the signing secret in `STRIPE_WEBHOOK_SECRET`. A paid Checkout session unlocks the scan referenced in the session metadata. The $99 price also adds one rescan credit. The subscription marks the account active so new scans and scheduled rescans open the full report.

Until those env vars are set, the upgrade buttons return a clear configuration error and the free teaser still works.

Signature checks and tier unlocking do not need a Stripe account. `src/lib/stripe-webhook.test.ts` builds a Checkout event, signs it with Stripe's test header helper, and posts it at the webhook route. With the local fixture values below, a `report` event sets that scan to full access, a `rescan` event adds one rescan credit and one report credit, a second delivery of the same event id does not apply again, and a subscription event marks the account active. A missing or invalid signature returns 400 and writes nothing.

```text
STRIPE_SECRET_KEY=sk_test_local_fixture_not_a_real_key
STRIPE_WEBHOOK_SECRET=whsec_local_fixture_not_from_stripe
```

Those two values are not a Stripe account. A real test-mode setup still needs all of the following from the Stripe dashboard (or from `stripe listen` for the webhook secret):

- `STRIPE_SECRET_KEY` (`sk_test_...`) so Checkout can create a session
- `STRIPE_WEBHOOK_SECRET` (`whsec_...`) from the dashboard endpoint or `stripe listen`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_...`)
- `STRIPE_PRICE_REPORT`, `STRIPE_PRICE_RESCAN`, and `STRIPE_PRICE_MONITOR`

`scripts/e2e-local.sh` runs the fixture test and then posts one signed `report` event at the running app. It does not call Stripe.

## Email

Monitoring alerts are always stored on the dashboard. If `SMTP_HOST` is set, the worker also sends them with Nodemailer. Magic links use the same SMTP settings. In development, `DEV_EXPOSE_MAGIC_LINK=true` shows the link on the login form.

## Auth

Magic links are stored as hashes. The session cookie is HTTP-only. This avoids a third-party auth vendor for the MVP. Swap in your own mailer by keeping the same `/api/auth/request` and `/api/auth/verify` routes.

## Deploy

**Web on Vercel.** Set the env vars from `.env.example`. Use a hosted Postgres `DATABASE_URL`. The build command can stay `npm run build`. Run `prisma db push` (or a migration) against that database before traffic. Do not run the worker on Vercel. Point `REDIS_URL` at a hosted Redis instance so the web app can enqueue scans.

**Worker on Railway or Fly.** Use `Dockerfile.worker`. Same `DATABASE_URL` and `REDIS_URL`. Set `PLAYWRIGHT_ENABLED=true` if you want the rendered-page pass. Set `ALLOW_LOCAL_TARGETS=false`. Set `APP_URL` to the public web origin so alert links and magic links are correct.

**One VM.** Local `docker compose up --build` runs Postgres, Redis, web, worker, and the demo targets. Do not publish that file. A public server uses `docker-compose.prod.yml`, which has no demo targets. The step-by-step is [docs/DEPLOY_SELF_HOSTED.md](docs/DEPLOY_SELF_HOSTED.md): AWS Free plan first, then any other Linux VM with the same files.

Dodo webhooks should target `https://<your-web-host>/api/dodo/webhook`. Stripe webhooks should target `https://<your-web-host>/api/stripe/webhook`. New checkouts follow `PAYMENT_PROVIDER`.

## Project layout

```text
src/app            Next.js App Router UI and HTTP routes
src/lib            Catalog, sanitizer, score, badge, ownership, Stripe, Dodo Payments
src/worker         Queue worker and scan modules
demo-targets       Intentionally insecure local fixtures
docs               Security checklist
```

Raw module ids stay in the database `raw` column. The report renderer strips tool brand names and secret values before anything is shown or returned to the browser.

## Scripts

```bash
npm run dev          # web
npm run worker       # queue consumer
npm run demos        # three local demo origins
npm test             # catalog, sanitizer, score, badge, demo-target scans, Dodo checkout, webhook fixtures when DATABASE_URL is set
npm run checklist    # regenerate docs/SECURITY_CHECKLIST.md
npm run db:push
bash scripts/e2e-local.sh   # Postgres, Redis, web, worker, and the signed-in scan flow
bash scripts/dev-install.sh # Cursor Install Script: npm ci and prisma generate
bash scripts/dev-start.sh   # Cursor Start Script: Postgres, Redis, demos, web, worker
```

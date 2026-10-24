# VibeCheck

VibeCheck is a point-in-time security report for indie builders shipping apps from Lovable, Bolt, Supabase, Firebase, and similar tools. You prove you own the origin, consent to a non-destructive scan, and get findings with evidence, impact, and a fix you can paste.

Customer-facing reports never name the libraries used to collect evidence. They show the finding, not the tool.

This is not a certification, and it is not a promise that an app stays safe after the scan date.

## What you get

| Tier | Price | Unlocks |
| --- | --- | --- |
| Free teaser | $0 | Full scan runs and is stored. The page shows the score, severity counts, family coverage, and two sample issues. The rest of the evidence stays locked. |
| Full report | $49 once | Every finding on that scan: evidence, impact, and copy-paste fix. |
| Report + rescan | $99 once | The full report, plus one credit to run another full-access scan after you fix things. |
| Monitoring | $29/month | Full reports while the subscription is active, a scheduled rescan of a verified origin, and an alert when a new high-severity issue appears. |

The mini check is separate and free. It only runs header and public-file checks, and the coverage summary marks every other family as not run.

A finished scan can opt into a public score page and an SVG badge. Those show the score and the scan date. They do not show findings. After 30 days they read **rescan needed**.

Score starts at 100. Critical findings subtract 25, high 12, medium 6, low 2. A score of 85 or higher with no critical or high findings is labeled Passed VibeCheck.

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

See [demo-targets/README.md](demo-targets/README.md). Do not deploy those processes.

Sign in with any email. With `DEV_EXPOSE_MAGIC_LINK=true` the login screen prints the link so you do not need SMTP.

### Without Docker

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

`npm test` does not need Postgres or Redis. It checks the catalog, the report sanitizer, scoring, badge freshness, and a scan of the three demo targets.

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

The worker checks the proof again when the job starts. If you remove it, the scan stops before any probe. Local demo apps keep the token in memory. The scan form can install it for ports 4010–4012 when `ALLOW_LOCAL_TARGETS=true`.

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

The headless render is optional. Set `PLAYWRIGHT_ENABLED=false` to use HTTP fetching only. Static bundles are still downloaded and reviewed. If the browser cannot launch, the scan continues with the fetched files and does not mention that in the report.

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

## Email

Monitoring alerts are always stored on the dashboard. If `SMTP_HOST` is set, the worker also sends them with Nodemailer. Magic links use the same SMTP settings. In development, `DEV_EXPOSE_MAGIC_LINK=true` shows the link on the login form.

## Auth

Magic links are stored as hashes. The session cookie is HTTP-only. This avoids a third-party auth vendor for the MVP. Swap in your own mailer by keeping the same `/api/auth/request` and `/api/auth/verify` routes.

## Deploy

**Web on Vercel.** Set the env vars from `.env.example`. Use a hosted Postgres `DATABASE_URL`. The build command can stay `npm run build`. Run `prisma db push` (or a migration) against that database before traffic. Do not run the worker on Vercel. Point `REDIS_URL` at a hosted Redis instance so the web app can enqueue scans.

**Worker on Railway or Fly.** Use `Dockerfile.worker`. Same `DATABASE_URL` and `REDIS_URL`. Set `PLAYWRIGHT_ENABLED=true` if you want the rendered-page pass. Set `ALLOW_LOCAL_TARGETS=false`. Set `APP_URL` to the public web origin so alert links and magic links are correct.

**One VM.** `docker compose up --build` runs Postgres, Redis, web, worker, and the demo targets. Remove the demo services before any public deploy, and turn off local targets.

Stripe webhooks should target `https://<your-web-host>/api/stripe/webhook`.

## Project layout

```text
src/app            Next.js App Router UI and HTTP routes
src/lib            Catalog, sanitizer, score, badge, ownership, Stripe
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
npm test             # catalog, sanitizer, score, badge, demo-target scans
npm run checklist    # regenerate docs/SECURITY_CHECKLIST.md
npm run db:push
```

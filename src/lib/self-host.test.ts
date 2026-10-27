import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("production compose is a small VM stack without demo targets", () => {
  const compose = read("docker-compose.prod.yml");
  for (const service of ["postgres:", "redis:", "web:", "worker:", "caddy:", "migrate:"]) {
    assert.match(compose, new RegExp(service));
  }
  assert.match(compose, /noeviction/);
  assert.match(compose, /appendonly/);
  assert.match(compose, /WORKER_CONCURRENCY: \$\{WORKER_CONCURRENCY:-1\}/);
  assert.match(compose, /memory: 1408M/);
  assert.match(compose, /memory: 896M/);
  assert.match(compose, /unless-stopped/);
  assert.match(compose, /"80:80"/);
  assert.match(compose, /"443:443"/);
  assert.match(compose, /pgdata:/);
  assert.match(compose, /redisdata:/);
  assert.match(compose, /ALLOW_LOCAL_TARGETS: "false"/);
  assert.match(compose, /DEV_EXPOSE_MAGIC_LINK: "false"/);
  assert.match(compose, /prisma-deploy\.sh/);
  assert.doesNotMatch(compose, /demo-targets|demo-open|demo-paywall|demo-leaky|demo-logged-in|4010/);
  assert.doesNotMatch(compose, /5432:5432|6379:6379/);
  assert.doesNotMatch(compose, /platform:\s*linux\/amd64/);
});

test("Dockerfiles install Playwright Chromium for the image architecture", () => {
  for (const file of ["Dockerfile", "Dockerfile.worker"]) {
    const text = read(file);
    const browsers = text.indexOf("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    const install = text.indexOf("npx playwright install --with-deps chromium");
    assert.ok(browsers >= 0 && install > browsers, file);
    assert.match(text, /linux\/arm64/);
    assert.doesNotMatch(text, /apt-get install[^\\n]*chromium/);
    assert.doesNotMatch(text, /--platform/);
  }
  assert.match(read(".dockerignore"), /demo-targets/);
  assert.match(read("deploy/Caddyfile"), /reverse_proxy web:3000/);
  assert.match(read("deploy/Caddyfile"), /\{\$SITE_ADDRESS\}/);
});

test("migrations create ScanCredential and cover every Prisma model", () => {
  const schema = read("prisma/schema.prisma");
  const models = [...schema.matchAll(/^model (\w+)/gm)].map((match) => match[1]);
  assert.ok(models.includes("ScanCredential"));
  const migrationDir = path.join(root, "prisma/migrations");
  const sql = readdirSync(migrationDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(path.join(migrationDir, entry.name, "migration.sql"), "utf8"))
    .join("\n");
  for (const model of models) {
    assert.match(sql, new RegExp(`CREATE TABLE "${model}"`), model);
  }
  assert.match(read("scripts/prisma-deploy.sh"), /prisma migrate deploy/);
  assert.match(read("scripts/prisma-deploy.sh"), /to_regclass\('"ScanCredential"'\)::text/);
});

test("env example documents web, worker, and compose variables", () => {
  const example = read(".env.example");
  const required = [
    "NODE_ENV=",
    "APP_URL=",
    "NEXT_PUBLIC_SITE_URL=",
    "SESSION_SECRET=",
    "DEV_EXPOSE_MAGIC_LINK=",
    "ALLOW_LOCAL_TARGETS=",
    "LOCALHOST_REWRITE_HOST=",
    "DATABASE_URL=",
    "REDIS_URL=",
    "POSTGRES_USER=",
    "POSTGRES_PASSWORD=",
    "POSTGRES_DB=",
    "SITE_ADDRESS=",
    "ACME_EMAIL=",
    "SMTP_HOST=",
    "SMTP_PORT=",
    "SMTP_USER=",
    "SMTP_PASS=",
    "EMAIL_FROM=",
    "PAYMENT_PROVIDER=",
    "DODO_PAYMENTS_API_KEY=",
    "DODO_WEBHOOK_SECRET=",
    "DODO_ENV=",
    "DODO_PRODUCT_REPORT=",
    "DODO_PRODUCT_RESCAN=",
    "DODO_PRODUCT_MONITOR=",
    "STRIPE_SECRET_KEY=",
    "STRIPE_WEBHOOK_SECRET=",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=",
    "STRIPE_PRICE_REPORT=",
    "STRIPE_PRICE_RESCAN=",
    "STRIPE_PRICE_MONITOR=",
    "CREDENTIALS_ENCRYPTION_KEY=",
    "PLAYWRIGHT_ENABLED=",
    "PLAYWRIGHT_CHANNEL=",
    "PLAYWRIGHT_BROWSERS_PATH=",
    "BROWSER_TIMEOUT_MS=",
    "WORKER_CONCURRENCY=",
    "ABUSE_CONTACT_EMAIL=",
    "SCAN_TARGET_CONCURRENCY=",
    "SCAN_TARGET_MIN_INTERVAL_MS=",
    "MONITOR_INTERVAL_HOURS=",
    "BADGE_STALE_DAYS=",
    "BACKUP_RETENTION_DAYS=",
    "REDIS_MAXMEMORY=",
  ];
  for (const key of required) assert.match(example, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), key);
});

test("deploy, backup, and the AWS guide are present", () => {
  const deploy = read("scripts/deploy.sh");
  assert.match(deploy, /git pull --ff-only/);
  assert.match(deploy, /docker compose -f docker-compose\.prod\.yml up -d --build/);
  assert.match(read("scripts/backup-postgres.sh"), /pg_dump/);
  assert.match(read("scripts/backup-postgres.sh"), /BACKUP_RETENTION_DAYS/);
  assert.match(read("scripts/restore-postgres.sh"), /pg_restore/);
  assert.match(read("scripts/restore-postgres.sh"), /--yes/);
  const guide = read("docs/DEPLOY_SELF_HOSTED.md");
  for (const phrase of [
    "ap-south-1",
    "Elastic IP",
    "EC2 Instance Connect",
    "t4g",
    "Cloudflare",
    "DODO_WEBHOOK_SECRET",
    "/api/dodo/webhook",
    "CREDENTIALS_ENCRYPTION_KEY",
    "NEXT_PUBLIC_SITE_URL",
    "Before January 18, 2027",
    "t4g.medium",
    "$140",
    "$0.0224",
    "Hostinger",
    "DigitalOcean",
    "Oracle",
    "iptables",
    "Responding to an AWS abuse report",
    "ABUSE_CONTACT_EMAIL",
    "export-abuse-records.ts",
    "/scanner-info",
  ]) {
    assert.ok(guide.includes(phrase), phrase);
  }
  assert.doesNotMatch(guide, /sk_live_|whsec_[A-Za-z0-9]{8,}/);
});

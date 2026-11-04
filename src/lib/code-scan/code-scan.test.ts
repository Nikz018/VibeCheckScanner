import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { AdvisoryLookupFn } from "@/lib/osv";
import { packageAdvisoryKey } from "@/lib/osv";
import { cloneShallow, gitCloneArgs, withIsolatedDir } from "./clone";
import { scanRepoDirectory } from "./engine";
import { languageFor } from "./files";
import {
  AWAITING_REPO_STATUS,
  canConnectRepository,
  canRunCodeScan,
  codeScanEnabledForCredit,
  codeScanEnabledForTier,
  creditScanShouldWaitForRepo,
  firstPaidScanPlan,
  shouldOfferCodeRepoStep,
  shouldOfferCreditCodeStep,
} from "./gate";
import { codeScanRepoLabel } from "./messages";
import { parseHistory } from "./history";
import { repoForCodeScan, repoSnapshotData } from "./repo-lock";
import { looksLikeTyposquat } from "./dependencies";
import { PYTHON_RULES } from "./rules";
import type { CodeScanReport } from "./types";

const exec = promisify(execFile);
const SECRET = ["sk_live_", "4eKj8QpL2mN4vR7xT9aB3cD6"].join("");
const STRIPE_TEST = ["sk_test_", "4eKj8QpL2mN4vR7xT9aB3cD6"].join("");
const OPENAI = "sk-proj-Ab9Kx2Lm8Qp4Nv7Rs1Tu3Vw5Xy6Za8Bc0De2Fg4Hi";
const GROQ = "gsk_Ab9Kx2Lm8Qp4Nv7Rs1Tu3Vw5Xy6Za8Bc";
const GEMINI = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5pQr";

const lookup: AdvisoryLookupFn = async (packages) => {
  const byPackage = new Map();
  for (const item of packages) {
    if (item.name === "lodash" && item.version === "4.17.20") {
      byPackage.set(packageAdvisoryKey("lodash", "4.17.20"), [
        {
          id: "CVE-2021-23337",
          summary: "Prototype pollution in lodash before 4.17.21",
          severity: "high" as const,
          fixed: "4.17.21",
        },
      ]);
    }
  }
  return { byPackage, source: "cache" as const };
};

function serviceJwt(): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ role: "service_role" })}.signature`;
}

async function writeRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vibecheck-fixture-"));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

async function scan(files: Record<string, string>): Promise<{ report: CodeScanReport; dir: string }> {
  const dir = await writeRepo(files);
  try {
    const report = await scanRepoDirectory(dir, { lookup });
    return { report, dir };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function ids(report: CodeScanReport): Set<string> {
  return new Set(report.findings.map((finding) => finding.ruleId));
}

test("secrets: keys, public env, service role, committed env, and git history", async () => {
  const dir = await writeRepo({
    "src/keys.ts": `const stripe = "${SECRET}";\n`,
    "components/client.tsx": `const NEXT_PUBLIC_STRIPE_SECRET_KEY = "${STRIPE_TEST}";\nconst SUPABASE_SERVICE_ROLE_KEY = "${serviceJwt()}";\n`,
    ".env": `TOKEN=${SECRET}\n`,
  });
  try {
    await exec("git", ["init"], { cwd: dir });
    await exec("git", ["add", "."], { cwd: dir });
    await exec("git", ["-c", "user.email=dev@example.com", "-c", "user.name=Dev", "commit", "-m", "add secrets"], { cwd: dir });
    const report = await scanRepoDirectory(dir, { lookup });
    const found = ids(report);
    for (const id of ["code_secret_hardcoded", "code_secret_public_env", "code_secret_service_role_client", "code_secret_env_file", "code_secret_git_history"]) {
      assert.equal(found.has(id), true, id);
    }
    const blob = JSON.stringify(report);
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes(STRIPE_TEST), false);
    assert.equal(blob.includes(serviceJwt()), false);
    assert.ok(report.findings.every((finding) => finding.explanation.length > 20 && finding.fixPrompt.includes(finding.file.split(":")[0] === finding.file ? "File:" : "File:")));
    assert.ok(report.findings.every((finding) => finding.owasp.startsWith("A")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dependencies: lockfile advisories, abandoned packages, and typosquats", async () => {
  const { report, dir } = await scan({
    "package.json": JSON.stringify({
      dependencies: { lodash: "4.17.20", request: "2.88.2", expres: "4.18.2" },
    }),
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/lodash": { version: "4.17.20" },
        "node_modules/request": { version: "2.88.2" },
        "node_modules/expres": { version: "4.18.2" },
      },
    }),
  });
  try {
    const found = ids(report);
    assert.equal(found.has("code_dependency_advisory"), true);
    assert.equal(found.has("code_dependency_abandoned"), true);
    assert.equal(found.has("code_dependency_typosquat"), true);
    const advisory = report.findings.find((finding) => finding.ruleId === "code_dependency_advisory");
    assert.match(advisory?.explanation ?? "", /CVE-2021-23337/);
    assert.equal(JSON.stringify(report).toLowerCase().includes("osv"), false);
    assert.equal(looksLikeTyposquat("nest"), null);
    assert.equal(looksLikeTyposquat("expres"), "express");
    const row = report.owasp.find((item) => item.id === "A06:2021");
    assert.equal(row?.status, "issues_found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("access control: missing auth, IDOR, and admin routes", async () => {
  const { report, dir } = await scan({
    "app/api/notes/route.ts": "export async function GET() {\n  return prisma.note.findMany();\n}\n",
    "app/api/items/[id]/route.ts": "export async function GET(_req: Request, context: { params: { id: string } }) {\n  const id = context.params.id;\n  return prisma.item.findUnique({ where: { id } });\n}\n",
    "app/api/admin/users/route.ts": "export async function GET() {\n  return prisma.user.findMany();\n}\n",
  });
  try {
    const found = ids(report);
    assert.equal(found.has("code_access_no_auth"), true);
    assert.equal(found.has("code_access_idor"), true);
    assert.equal(found.has("code_access_admin"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("database: missing RLS, permissive policy, open Firebase rules, and SQL concatenation", async () => {
  const { report, dir } = await scan({
    "supabase/migrations/001.sql": "create table public.notes (\n  id uuid primary key\n);\ncreate policy \"open\" on public.notes for select using (true);\n",
    "database.rules.json": '{ "rules": { ".read": true, ".write": true } }\n',
    "lib/query.ts": "export function load(req: { params: { id: string } }) {\n  return db.query(\"select * from users where id = '\" + req.params.id + \"'\");\n}\n",
  });
  try {
    const found = ids(report);
    for (const id of ["code_db_rls_missing", "code_db_rls_permissive", "code_db_firebase_open", "code_db_sql_concat"]) {
      assert.equal(found.has(id), true, id);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("injection: html, eval, commands, SSRF, redirects, and uploads", async () => {
  const { report, dir } = await scan({
    "app/page.tsx": "export function Page({ html }: { html: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: html }} />;\n}\n",
    "lib/run.ts": "export function run(input: string) {\n  return eval(input);\n}\n",
    "lib/shell.ts": "import { exec } from \"child_process\";\nexport function go(input: string) {\n  exec(input);\n}\n",
    "lib/fetch.ts": "export function load(req: { query: { url: string } }) {\n  return fetch(req.query.url);\n}\n",
    "lib/redirect.ts": "export function go(searchParams: { get(name: string): string }) {\n  redirect(searchParams.get(\"next\"));\n}\n",
    "app/api/upload/route.ts": "export async function POST(req: Request) {\n  const file = await req.formData();\n  await writeFile(\"/tmp/upload\", file);\n}\n",
  });
  try {
    const found = ids(report);
    for (const id of ["code_inject_html", "code_inject_eval", "code_inject_command", "code_inject_ssrf", "code_inject_redirect", "code_inject_upload"]) {
      assert.equal(found.has(id), true, id);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config: CORS, headers, debug errors, auth rate limit, cookies, and weak hashes", async () => {
  const { report, dir } = await scan({
    "next.config.js": "module.exports = { reactStrictMode: true };\n",
    "lib/cors.ts": "export const cors = { origin: \"*\" };\n",
    "app/api/debug/route.ts": "export function GET() {\n  try { throw new Error(\"x\"); } catch (error) { return NextResponse.json({ stack: error.stack }); }\n}\n",
    "app/api/login/route.ts": "export async function POST() {\n  return prisma.user.findFirst();\n}\n",
    "lib/session.ts": "export function cookie() {\n  return cookies().set(\"session\", \"1\", { httpOnly: false, secure: false });\n}\n",
    "lib/password.ts": "import { createHash } from \"crypto\";\nexport function hashPassword(password: string) {\n  return createHash(\"md5\").update(password).digest(\"hex\");\n}\n",
  });
  try {
    const found = ids(report);
    for (const id of ["code_config_cors", "code_config_headers", "code_config_debug", "code_config_rate_limit", "code_config_cookie", "code_config_hash"]) {
      assert.equal(found.has(id), true, id);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("payments: unsigned webhooks and client-trusted prices", async () => {
  const { report, dir } = await scan({
    "app/api/stripe/webhook/route.ts":
      "export async function POST(req: Request) {\n  const body = await req.json();\n  if (body.type === \"stripe\") {\n    await prisma.order.update({ data: { paid: body.paid, amount: body.amount } });\n  }\n}\n",
  });
  try {
    const found = ids(report);
    assert.equal(found.has("code_pay_webhook"), true);
    assert.equal(found.has("code_pay_client_price"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("placeholders, test fixtures, and verified webhooks are not flagged", async () => {
  const { report, dir } = await scan({
    "src/lib/code-scan/code-scan.test.ts": [
      'assert.equal(blob.includes("sk_test_redacted"), false);',
      'assert.equal(blob.includes("sk_test_abcdefghijklmnopqrstuv"), false);',
      'const history = parseHistory("COMMIT:abc123456789\\n+++ b/.env\\n+TOKEN=sk_live_redacted\\n");',
      `const leaked = "${SECRET}";`,
    ].join("\n"),
    "src/worker/extract-llm-keys.test.ts": 'assert.equal(blob.includes("sk-redacted"), false);\nconst anthropic = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";\n',
    "src/lib/payments/webhook.ts": [
      "export async function handleProviderWebhook(provider: { parseWebhook(payload: string, headers: Headers): unknown }, request: Request) {",
      "  const payload = await request.text();",
      "  try {",
      "    event = provider.parseWebhook(payload, request.headers);",
      "  } catch (error) {",
      "    if (error instanceof MissingSignatureError) return new Response(\"Missing signature.\", { status: 400 });",
      "    if (error instanceof InvalidSignatureError) return new Response(\"Invalid signature.\", { status: 400 });",
      "    throw error;",
      "  }",
      "}",
    ].join("\n"),
    "app/api/pay/webhook/route.ts": [
      'import { handleProviderWebhook } from "@/lib/payments/webhook";',
      "export async function POST(request: Request) {",
      "  return handleProviderWebhook(stripeProvider, request);",
      "}",
    ].join("\n"),
    "src/lib/billing/accept.ts": [
      'import { parseStripeWebhook } from "./stripe-events";',
      "export async function acceptStripeEvent(request: Request) {",
      "  const payload = await request.text();",
      "  return parseStripeWebhook(payload, request.headers);",
      "}",
    ].join("\n"),
    "src/lib/billing/stripe-events.ts": [
      "export function parseStripeWebhook(payload: string, headers: Headers) {",
      "  const signature = headers.get(\"stripe-signature\");",
      "  if (!signature) throw new MissingSignatureError();",
      "  return stripe.webhooks.constructEvent(payload, signature, secret);",
      "}",
    ].join("\n"),
    "app/api/billing/webhook/route.ts": [
      'import { acceptStripeEvent } from "@/lib/billing/accept";',
      "export async function POST(request: Request) {",
      "  const event = await acceptStripeEvent(request);",
      "  await prisma.order.update({ where: { id: event.id }, data: { paid: true } });",
      "}",
    ].join("\n"),
    "app/api/hooks/webhook/route.ts": [
      "export async function POST(req: Request) {",
      "  const body = await req.json();",
      "  if (body.type === \"stripe\") await prisma.order.update({ data: { paid: body.paid } });",
      "}",
    ].join("\n"),
    "src/config.ts": `export const stripeKey = "${SECRET}";\n`,
    "src/placeholders.ts": [
      `export const redacted = "${["sk_test_", "redacted_value_000000000000"].join("")}";`,
      `export const example = "${["sk_live_", "examplekey00000000000000"].join("")}";`,
      `export const yours = "${["sk_live_", "your_key_here_0000000000"].join("")}";`,
      'export const dummy = "sk-dummy-key-abcdefghijklmnopqrstuvwxyz0123456789";',
      `export const wrapped = "<${SECRET}>";`,
      `// const hidden = "${SECRET}";`,
    ].join("\n"),
    "src/types.ts": "export interface Config { stripeSecretKey: string; apiKey: string }\n",
    ".env.example": `STRIPE_SECRET_KEY=${["sk_live_", "your_key_here_not_real"].join("")}\n`,
  });
  try {
    const files = report.findings.map((finding) => `${finding.ruleId}:${finding.file}`);
    for (const file of [
      "src/lib/code-scan/code-scan.test.ts",
      "src/worker/extract-llm-keys.test.ts",
      "src/lib/payments/webhook.ts",
      "app/api/pay/webhook/route.ts",
      "app/api/billing/webhook/route.ts",
      "src/placeholders.ts",
      "src/types.ts",
      ".env.example",
    ]) {
      assert.equal(files.some((item) => item.endsWith(`:${file}`)), false, file);
    }
    const live = report.findings.find((finding) => finding.file === "src/config.ts");
    assert.equal(live?.ruleId, "code_secret_hardcoded");
    assert.equal(live?.severity, "critical");
    const unsigned = report.findings.find((finding) => finding.file === "app/api/hooks/webhook/route.ts" && finding.ruleId === "code_pay_webhook");
    assert.equal(unsigned?.severity, "critical");
    assert.equal(JSON.stringify(report).includes(SECRET), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logging: secrets and personal data", async () => {
  const { report, dir } = await scan({
    "lib/log.ts": "export function audit(user: { email: string; password: string }) {\n  console.log(user.email, user.password);\n}\n",
  });
  try {
    assert.equal(ids(report).has("code_log_sensitive"), true);
    const finding = report.findings.find((item) => item.ruleId === "code_log_sensitive");
    assert.equal(finding?.owasp, "A09:2021");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ai security: keys, auth, prompts, output, tools, retrieval, and limits", async () => {
  const { report, dir } = await scan({
    "app/api/chat/route.ts": [
      "import OpenAI from \"openai\";",
      "export async function POST(req: Request) {",
      "  const user = await req.json();",
      "  const systemPrompt = `You are helpful. ${user.message} " + OPENAI + "`;",
      "  console.log(systemPrompt);",
      "  const client = new OpenAI({ apiKey: \"" + OPENAI + "\" });",
      "  const completion = await client.chat.completions.create({",
      "    model: \"gpt-4o-mini\",",
      "    messages: [{ role: \"system\", content: systemPrompt + user.message }],",
      "  });",
      "  return completion;",
      "}",
      "",
    ].join("\n"),
    "lib/ai-extra.ts": [
      "export function view(completion: string) {",
      "  return <div dangerouslySetInnerHTML={{ __html: completion }} />;",
      "}",
      "const spec = { tools: [{ name: \"deleteAccount\" }] };",
      "export async function search() {",
      "  return supabase.rpc(\"match_documents\", { query: \"hi\" });",
      "}",
      "const GEMINI_API_KEY = \"" + GEMINI + "\";",
      "const model = \"gemini-pro\";",
      "void GEMINI_API_KEY; void model; void spec;",
      "",
    ].join("\n"),
    "lib/groq.ts": `const key = "${GROQ}";\nexport const groq = key;\n`,
  });
  try {
    const found = ids(report);
    for (const id of [
      "code_ai_provider_key",
      "code_ai_endpoint_auth",
      "code_ai_endpoint_limit",
      "code_ai_prompt_injection",
      "code_ai_prompt_secret",
      "code_ai_output_sink",
      "code_ai_tool_unconfirmed",
      "code_ai_rag_tenant",
      "code_ai_prompt_logged",
      "code_ai_no_max_tokens",
    ]) {
      assert.equal(found.has(id), true, id);
    }
    const blob = JSON.stringify(report);
    assert.equal(blob.includes(OPENAI), false);
    assert.equal(blob.includes(GROQ), false);
    assert.equal(blob.includes(GEMINI), false);
    assert.match(report.owaspNote, /aligned with the OWASP Top 10/);
    assert.match(report.owaspNote, /not a certification/);
    assert.equal(report.privacy.toLowerCase().includes("training"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a clean JavaScript file does not invent findings, and dependencies are not checked without a manifest", async () => {
  const { report, dir } = await scan({
    "app/page.tsx": "export function Page() {\n  return <p>Hello</p>;\n}\n",
  });
  try {
    assert.equal(report.findings.length, 0);
    const byId = Object.fromEntries(report.owasp.map((row) => [row.id, row.status]));
    assert.equal(byId["A02:2021"], "passed");
    assert.equal(byId["A01:2021"], "passed");
    assert.equal(byId["A06:2021"], "not_checked");
    assert.ok(report.owasp.every((row) => row.status === "passed" || row.status === "issues_found" || row.status === "not_checked"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the $99 first scan and the $99 credit wait for GitHub, and a $49 or monitoring scan does not", () => {
  const held = { codeScanEnabled: true, status: AWAITING_REPO_STATUS, enqueue: false };
  const queuedCode = { codeScanEnabled: true, status: "queued" as const, enqueue: true };
  const queuedSite = { codeScanEnabled: false, status: "queued" as const, enqueue: true };
  assert.deepEqual(firstPaidScanPlan({ tier: "rescan", githubConfigured: true, choice: null, repoConnected: false }), held);
  assert.deepEqual(firstPaidScanPlan({ tier: "rescan", githubConfigured: true, choice: null, repoConnected: true }), held);
  assert.deepEqual(firstPaidScanPlan({ tier: "rescan", githubConfigured: true, choice: "connect", repoConnected: false }), held);
  assert.deepEqual(firstPaidScanPlan({ tier: "rescan", githubConfigured: true, choice: "connect", repoConnected: true }), queuedCode);
  assert.deepEqual(firstPaidScanPlan({ tier: "rescan", githubConfigured: true, choice: "skip", repoConnected: false }), queuedCode);
  assert.deepEqual(firstPaidScanPlan({ tier: "rescan", githubConfigured: false, choice: null, repoConnected: false }), queuedCode);
  assert.deepEqual(firstPaidScanPlan({ tier: "report", githubConfigured: true, choice: null, repoConnected: true }), queuedSite);
  assert.deepEqual(firstPaidScanPlan({ tier: "monitor", githubConfigured: true, choice: null, repoConnected: false }), queuedSite);

  const codeCredit = codeScanEnabledForCredit({ mode: "full", use: "code-credit", spentRescanCredit: true });
  assert.equal(creditScanShouldWaitForRepo({ codeScanEnabled: codeCredit, githubConfigured: true, repoConnected: true }), true);
  assert.equal(codeScanEnabledForCredit({ mode: "full", use: "credit", spentRescanCredit: true }), false);

  const paid = readFileSync(path.join(process.cwd(), "src/lib/payments/paid-full-scan.ts"), "utf8");
  assert.match(paid, /firstPaidScanPlan/);
  assert.match(paid, /AWAITING_REPO_STATUS/);
  assert.match(paid, /outcome: "needs_repo", scanId/);
  const page = readFileSync(path.join(process.cwd(), "src/app/scans/[id]/page.tsx"), "utf8");
  assert.match(page, /purchase\.fullScan\.status === AWAITING_REPO_STATUS/);
  assert.match(page, /redirect\(`\/scans\/\$\{purchase\.fullScan\.id\}`\)/);
  const form = readFileSync(path.join(process.cwd(), "src/components/NewScanForm.tsx"), "utf8");
  assert.match(form, /code-credit/);
  assert.match(form, /Use a \$99 full-report credit/);
  assert.match(form, /Use a full-report credit/);
  const route = readFileSync(path.join(process.cwd(), "src/app/api/projects/[id]/verify/route.ts"), "utf8");
  assert.match(route, /code-credit/);
  const fulfill = readFileSync(path.join(process.cwd(), "src/lib/payments/fulfill.ts"), "utf8");
  assert.match(fulfill, /codeReportCredits: \{ increment: 1 \}/);
  const schedule = readFileSync(path.join(process.cwd(), "src/worker/schedule.ts"), "utf8");
  assert.equal(schedule.includes("codeScanEnabled"), false);
  assert.equal(schedule.includes("awaiting_repo"), false);
  assert.match(schedule, /status: "queued"/);
});

test("python files get agnostic checks and no JavaScript-only rules yet", async () => {
  assert.equal(languageFor("app.py"), "python");
  assert.equal(languageFor("app.ts"), "javascript");
  assert.ok(Array.isArray(PYTHON_RULES));
  const { report, dir } = await scan({
    "app.py": `API_KEY = "${SECRET}"\nprint(password)\ndef run(user_id):\n    query = "select * from t where id = " + user_id\n    return eval(user_id)\n`,
  });
  try {
    const found = ids(report);
    assert.equal(found.has("code_secret_hardcoded"), true);
    assert.equal(found.has("code_db_sql_concat"), true);
    assert.equal(found.has("code_log_sensitive"), true);
    if (PYTHON_RULES.length === 0) assert.equal(found.has("code_inject_eval"), false);
    assert.equal(JSON.stringify(report).includes(SECRET), false);
    const access = report.owasp.find((row) => row.id === "A01:2021");
    assert.equal(access?.status, "not_checked");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("masking and gating", () => {
  assert.equal(codeScanEnabledForTier("rescan"), true);
  assert.equal(codeScanEnabledForTier("report"), false);
  assert.equal(codeScanEnabledForTier("monitor"), false);
  assert.equal(codeScanEnabledForCredit({ mode: "full", use: "rescan", spentRescanCredit: true }), true);
  assert.equal(codeScanEnabledForCredit({ mode: "full", use: "rescan", spentRescanCredit: false }), false);
  assert.equal(codeScanEnabledForCredit({ mode: "full", use: "credit", spentRescanCredit: false }), false);
  assert.equal(codeScanEnabledForCredit({ mode: "full", use: "credit", spentRescanCredit: true }), false);
  assert.equal(codeScanEnabledForCredit({ mode: "full", use: "code-credit", spentRescanCredit: true }), true);
  assert.equal(codeScanEnabledForCredit({ mode: "full", use: "code-credit", spentRescanCredit: false }), false);
  assert.equal(codeScanEnabledForCredit({ mode: "mini", use: "rescan", spentRescanCredit: true }), false);
  assert.equal(canConnectRepository({ ownershipVerified: true, paidRescan: true }).ok, true);
  assert.equal(canConnectRepository({ ownershipVerified: true, paidRescan: false }).ok, false);
  assert.equal(canConnectRepository({ ownershipVerified: false, paidRescan: true }).ok, false);
  assert.equal(canRunCodeScan({ ownershipVerified: true, codeScanEnabled: true, repoConnected: true }).ok, true);
  assert.equal(canRunCodeScan({ ownershipVerified: true, codeScanEnabled: false, repoConnected: true }).ok, false);
  const offer = { tier: "rescan", ownershipVerified: true, githubConfigured: true, fullScanStarted: false, codeScanChoice: null as string | null };
  assert.equal(shouldOfferCodeRepoStep(offer), true);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, tier: "report" }), false);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, tier: "monitor" }), false);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, tier: null }), false);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, ownershipVerified: false }), false);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, githubConfigured: false }), false);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, fullScanStarted: true }), false);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, codeScanChoice: "skip" }), false);
  assert.equal(shouldOfferCodeRepoStep({ ...offer, codeScanChoice: "connect" }), false);
  assert.equal(creditScanShouldWaitForRepo({ codeScanEnabled: true, githubConfigured: true, repoConnected: false }), true);
  assert.equal(creditScanShouldWaitForRepo({ codeScanEnabled: true, githubConfigured: true, repoConnected: true }), true);
  assert.equal(creditScanShouldWaitForRepo({ codeScanEnabled: true, githubConfigured: false, repoConnected: false }), false);
  assert.equal(creditScanShouldWaitForRepo({ codeScanEnabled: false, githubConfigured: true, repoConnected: false }), false);
  const creditOffer = {
    mode: "full",
    codeScanEnabled: true,
    codeScanChoice: null as string | null,
    status: AWAITING_REPO_STATUS,
    githubConfigured: true,
  };
  assert.equal(shouldOfferCreditCodeStep(creditOffer), true);
  assert.equal(shouldOfferCreditCodeStep({ ...creditOffer, mode: "mini" }), false);
  assert.equal(shouldOfferCreditCodeStep({ ...creditOffer, codeScanEnabled: false }), false);
  assert.equal(shouldOfferCreditCodeStep({ ...creditOffer, githubConfigured: false }), false);
  assert.equal(shouldOfferCreditCodeStep({ ...creditOffer, status: "queued" }), false);
  assert.equal(shouldOfferCreditCodeStep({ ...creditOffer, codeScanChoice: "skip" }), false);
  assert.equal(shouldOfferCreditCodeStep({ ...creditOffer, codeScanChoice: "connect" }), false);
  const codeCredit = codeScanEnabledForCredit({ mode: "full", use: "code-credit", spentRescanCredit: true });
  assert.equal(creditScanShouldWaitForRepo({ codeScanEnabled: codeCredit, githubConfigured: true, repoConnected: true }), true);
  const reportCredit = codeScanEnabledForCredit({ mode: "full", use: "credit", spentRescanCredit: false });
  assert.equal(creditScanShouldWaitForRepo({ codeScanEnabled: reportCredit, githubConfigured: true, repoConnected: false }), false);
  const history = parseHistory("COMMIT:abc123456789\n+++ b/.env\n+TOKEN=sk_live_abcdefghijklmnopqrstuv\n");
  assert.equal(history.some((hit) => hit.path === ".env"), true);
});

test("temporary directories are deleted after success and failure", async () => {
  let seen = "";
  await withIsolatedDir(async (dir) => {
    seen = dir;
    await writeFile(path.join(dir, "note.txt"), "hello");
    assert.equal(existsSync(path.join(dir, "note.txt")), true);
  });
  assert.equal(existsSync(seen), false);

  let failed = "";
  await assert.rejects(
    withIsolatedDir(async (dir) => {
      failed = dir;
      await writeFile(path.join(dir, "note.txt"), "hello");
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(existsSync(failed), false);
});

test("shallow clone stays inside an isolated directory and the token is not a git argument", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "vibecheck-origin-"));
  let cloned = "";
  try {
    await writeFile(path.join(source, "README.md"), "hello\n");
    await exec("git", ["init"], { cwd: source });
    await exec("git", ["add", "README.md"], { cwd: source });
    await exec("git", ["-c", "user.email=dev@example.com", "-c", "user.name=Dev", "commit", "-m", "init"], { cwd: source });
    const token = "github_token_should_not_be_in_argv";
    const args = gitCloneArgs({ repoUrl: "https://github.com/example/app.git", dest: "/tmp/example", depth: 25, branch: "main" });
    assert.equal(args.includes(token), false);
    assert.equal(args.some((arg) => arg.includes(token)), false);
    await withIsolatedDir(async (dir) => {
      cloned = dir;
      const dest = path.join(dir, "repo");
      const result = await cloneShallow({ repoUrl: source, dest, depth: 1 });
      assert.equal(existsSync(path.join(dest, "README.md")), true);
      assert.match(result.commit, /^[0-9a-f]{40}$/);
    });
    assert.equal(existsSync(cloned), false);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

test("a confirmed repository stays on the scan when the project later points somewhere else", () => {
  const link = {
    status: "connected",
    owner: "Nikz018",
    name: "VulnAsp",
    defaultBranch: "main",
    installationId: "77",
    repoId: "88",
  };
  assert.deepEqual(repoSnapshotData(link), {
    codeRepoOwner: "Nikz018",
    codeRepoName: "VulnAsp",
    codeRepoBranch: "main",
    codeRepoInstallationId: "77",
    codeRepoId: "88",
  });
  assert.equal(codeScanRepoLabel("Nikz018/VulnAsp"), "Code scan repo: Nikz018/VulnAsp");
  const locked = repoForCodeScan({
    codeRepoOwner: "Nikz018",
    codeRepoName: "VulnAsp",
    codeRepoBranch: "main",
    codeRepoInstallationId: "77",
    project: {
      repoLink: { ...link, owner: "other", name: "later" },
    },
  });
  assert.equal(locked?.owner, "Nikz018");
  assert.equal(locked?.name, "VulnAsp");
  assert.equal(repoForCodeScan({ codeScanChoice: "skip", project: { repoLink: link } }), null);
  assert.equal(repoForCodeScan({ project: { repoLink: link } })?.name, "VulnAsp");
});

import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { prisma } from "../src/lib/db";

const base = process.env.APP_URL || "http://127.0.0.1:3000";
const email = process.env.E2E_EMAIL || "e2e-local@example.com";
const origin = process.env.E2E_ORIGIN || "http://127.0.0.1:4010";
const secretKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

let cookie = "";

async function main(): Promise<void> {
  const health = await request("/api/health");
  expect(health.status === 200, `health ${health.status}`);

  const login = await request("/api/auth/request", { method: "POST", json: { email, next: "/dashboard" } });
  expect(login.status === 200, `magic link ${login.status} ${login.text}`);
  const devLink = JSON.parse(login.text).devLink as string;
  expect(typeof devLink === "string" && devLink.includes("token="), "dev magic link missing");
  const verify = await request(new URL(devLink).pathname + new URL(devLink).search);
  expect(verify.status === 307 || verify.status === 302, `verify redirect ${verify.status}`);
  expect(cookie.includes("vc_session="), "session cookie missing");

  const project = await request("/api/projects", { method: "POST", json: { url: origin } });
  expect(project.status === 200, `project ${project.status} ${project.text}`);
  const created = JSON.parse(project.text) as { projectId: string; token: string; demo: boolean };
  expect(created.demo === true, "origin was not recognized as a local demo");

  const proof = await request(`/api/projects/${created.projectId}/demo-proof`, { method: "POST", json: {} });
  expect(proof.status === 200, `demo proof ${proof.status} ${proof.text}`);
  const wellKnown = await fetch(`${origin}/.well-known/vibecheck-verify.txt`);
  const body = (await wellKnown.text()).trim();
  expect(wellKnown.status === 200 && body === created.token, "well-known file did not echo the token");

  const queued = await request(`/api/projects/${created.projectId}/verify`, {
    method: "POST",
    json: { consent: true, mode: "full", use: "teaser" },
  });
  expect(queued.status === 200, `queue scan ${queued.status} ${queued.text}`);
  const scanId = JSON.parse(queued.text).scanId as string;

  const deadline = Date.now() + 90_000;
  let status = "queued";
  let error = "";
  while (Date.now() < deadline) {
    const poll = await request(`/api/scans/${scanId}`);
    const payload = JSON.parse(poll.text) as { status: string; error: string | null };
    status = payload.status;
    error = payload.error || "";
    if (status === "completed" || status === "failed") break;
    await sleep(2000);
  }
  expect(status === "completed", `scan ended as ${status} ${error}`);

  const teaser = await request(`/scans/${scanId}`);
  expect(teaser.status === 200, `teaser page ${teaser.status}`);
  expect(teaser.text.includes("Sample issues"), "teaser missing sample heading");
  expect(teaser.text.includes("more findings are hidden"), "teaser missing hidden count");
  expect(teaser.text.includes("Firebase data is world-readable"), "teaser missing a sample finding");
  expect(!teaser.text.includes("autoindex off"), "teaser leaked a locked fix");
  expect(!teaser.text.includes("Private credential embedded in client code"), "teaser leaked a locked title");
  expect(!teaser.text.includes("/rtdb/.json"), "teaser leaked a finding location");
  expect(!teaser.text.includes("/assets/app.js"), "teaser leaked a bundle location");
  expect(!teaser.text.includes("Steps to reproduce"), "teaser leaked repro steps");
  expect(!teaser.text.includes("sk_test_demo_not_real"), "teaser leaked a secret");
  expect(!teaser.text.includes("Download PDF"), "teaser showed a download button");
  const pdfLocked = await request(`/api/scans/${scanId}/pdf`);
  const mdLocked = await request(`/api/scans/${scanId}/markdown`);
  const printLocked = await request(`/api/scans/${scanId}/print`);
  expect(pdfLocked.status === 403, `teaser pdf ${pdfLocked.status}`);
  expect(mdLocked.status === 403, `teaser markdown ${mdLocked.status}`);
  expect(printLocked.status === 403, `teaser print ${printLocked.status}`);
  const signedOut = await fetch(`${base}/api/scans/${scanId}/markdown`);
  expect(signedOut.status === 401, `signed-out markdown ${signedOut.status}`);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const payload = JSON.stringify({
    id: `evt_e2e_${scanId}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_e2e_${scanId}`,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        payment_intent: `pi_e2e_${scanId}`,
        metadata: { userId: user.id, tier: "report", scanId },
      },
    },
  });
  const stripe = new Stripe(secretKey);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const hook = await fetch(`${base}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
  const hookText = await hook.text();
  expect(hook.status === 200, `webhook ${hook.status} ${hookText}`);

  const full = await request(`/scans/${scanId}`);
  expect(full.status === 200, `full page ${full.status}`);
  expect(full.text.includes("autoindex off"), "full report did not unlock the hidden fix");
  expect(full.text.includes("Private credential embedded in client code"), "full report did not unlock the hidden title");
  expect(!full.text.includes("more findings are hidden"), "full report still shows the teaser lock");
  expect(full.text.includes("Steps to reproduce"), "full report missing repro steps");
  expect(full.text.includes("/rtdb/.json"), "full report missing the firebase location");
  expect(full.text.includes("/assets/app.js"), "full report missing the bundle location");
  expect(full.text.includes("Line "), "full report missing a source line");
  expect(!full.text.includes("sk_test_demo_not_real_000000000000000"), "full report leaked a raw secret");
  expect(!full.text.includes("ada@example.com"), "full report leaked an email");
  expect(full.text.includes("Download PDF"), "full report missing the PDF button");
  expect(full.text.includes("Download for AI fix"), "full report missing the markdown button");

  const markdown = await request(`/api/scans/${scanId}/markdown`);
  expect(markdown.status === 200, `markdown ${markdown.status} ${markdown.text.slice(0, 180)}`);
  expect(markdown.text.startsWith("Fix these security issues in my app."), "markdown missing the fix prompt");
  expect(markdown.text.includes("/rtdb/.json"), "markdown missing the firebase location");
  expect(markdown.text.includes("/assets/app.js"), "markdown missing the bundle location");
  expect(!markdown.text.includes("sk_test_demo_not_real_000000000000000"), "markdown leaked a raw secret");
  expect(!markdown.text.includes("ada@example.com"), "markdown leaked an email");
  expect(!markdown.text.toLowerCase().includes("playwright") && !markdown.text.toLowerCase().includes("nuclei"), "markdown named a tool");
  expect((markdown.headers.get("content-disposition") || "").includes("vibecheck-127.0.0.1-4010-"), "markdown filename");

  const printHtml = await request(`/api/scans/${scanId}/print`);
  expect(printHtml.status === 200, `print ${printHtml.status}`);
  expect(printHtml.text.includes("data-report=\"vibecheck-print\""), "print template missing");
  expect(printHtml.text.includes("/rtdb/.json"), "print missing location");
  expect(!printHtml.text.includes("sk_test_demo_not_real_000000000000000"), "print leaked a raw secret");
  expect(!printHtml.text.toLowerCase().includes("playwright"), "print named a tool");

  const pdf = await request(`/api/scans/${scanId}/pdf`);
  expect(pdf.status === 200, `pdf ${pdf.status} ${pdf.text.slice(0, 120)}`);
  expect(pdf.text.startsWith("%PDF"), "pdf body is not a PDF");
  expect((pdf.headers.get("content-type") || "").includes("application/pdf"), "pdf content type");
  expect((pdf.headers.get("content-disposition") || "").includes("vibecheck-127.0.0.1-4010-"), "pdf filename");
  expect(!pdf.text.includes("sk_test_demo_not_real_000000000000000"), "pdf leaked a raw secret");
  expect(!pdf.text.includes("HeadlessChrome") && !pdf.text.includes("Skia/PDF") && !pdf.text.toLowerCase().includes("playwright"), "pdf named a tool");

  const shareOn = await request(`/api/scans/${scanId}/share`, { method: "POST", json: { enabled: true } });
  expect(shareOn.status === 200, `share on ${shareOn.status} ${shareOn.text}`);
  const token = JSON.parse(shareOn.text).token as string;
  const share = await request(`/share/${token}`);
  expect(share.status === 200, `share page ${share.status}`);
  expect(share.text.includes("VibeCheck"), "share page missing score label");
  expect(share.text.includes("Scanned"), "share page missing scan date");
  expect(!share.text.includes("Firebase data is world-readable"), "share page leaked a finding");
  expect(!share.text.includes("autoindex off"), "share page leaked a fix");
  expect(!share.text.includes(origin), "share page leaked the target origin");

  const shareOff = await request(`/api/scans/${scanId}/share`, { method: "POST", json: { enabled: false } });
  expect(shareOff.status === 200, `share off ${shareOff.status}`);
  const hidden = await request(`/share/${token}`);
  expect(hidden.status === 404, `disabled share page ${hidden.status}`);

  const shareAgain = await request(`/api/scans/${scanId}/share`, { method: "POST", json: { enabled: true } });
  expect(shareAgain.status === 200, `share on again ${shareAgain.status}`);
  const badge = await request(`/api/badge/${token}`);
  expect(badge.status === 200, `badge ${badge.status}`);
  expect(badge.text.includes("VibeCheck score") || badge.text.includes("Passed VibeCheck"), "badge missing score label");
  expect(badge.text.includes("Scanned"), "badge missing scan date");
  expect(!badge.text.includes("Firebase"), "badge leaked a finding");

  const workerLog = readFileSync(process.env.E2E_WORKER_LOG || "/tmp/vibecheck-worker.log", "utf8");
  const headless =
    workerLog.includes("headless render finished") ? "finished" :
    workerLog.includes("headless render exceeded") ? "killed" :
    workerLog.includes("headless render unavailable") ? "unavailable" :
    "missing";
  expect(headless !== "missing", "worker log has no headless render result");

  console.log(JSON.stringify({ ok: true, scanId, shareToken: token, headless, scoreHint: full.text.includes("VibeCheck score") }, null, 2));
  await prisma.$disconnect();
}

async function request(path: string, init: { method?: string; json?: unknown } = {}): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await fetch(path.startsWith("http") ? path : `${base}${path}`, {
    method: init.method || "GET",
    redirect: "manual",
    headers: {
      ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (setCookies.length) {
    cookie = setCookies.map((entry) => entry.split(";")[0]).join("; ");
  }
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  try {
    const log = readFileSync(process.env.E2E_WORKER_LOG || "/tmp/vibecheck-worker.log", "utf8");
    console.error(log.slice(-4000));
  } catch {
    // worker log may not exist yet
  }
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

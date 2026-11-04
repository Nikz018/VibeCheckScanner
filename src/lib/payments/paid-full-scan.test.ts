import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { CONSENT_TEXT } from "../ownership";
import { UPGRADE_ACTIONS } from "../pricing";
import { FULL_REPORT_PURCHASE_LEDE } from "../report";
import { containsToolBrand } from "../sanitize";
import {
  CODE_REPO_STEP_TITLE,
  CONNECT_GITHUB_CODE_SCAN_LABEL,
  FULL_SCAN_PROGRESS_LABEL,
  FULL_SCAN_STOPPED_LABEL,
  OPEN_FULL_REPORT_LABEL,
  REVERIFY_OWNERSHIP_LABEL,
  SKIP_CODE_SCAN_LABEL,
  START_FULL_SCAN_LABEL,
  codeScanDashboardPrompt,
  paidReportNotice,
  paidScanDashboardAction,
} from "./paid-scan-status";
import type { PaidFullScanDeps } from "./paid-full-scan";

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : "DATABASE_URL is not set";

test("paid scan status copy runs the full report after purchase", () => {
  assert.equal(FULL_SCAN_PROGRESS_LABEL, "Full scan in progress");
  assert.equal(FULL_SCAN_STOPPED_LABEL, "Full scan stopped");
  assert.equal(FULL_REPORT_PURCHASE_LEDE, "After purchase, the full report runs every check on this origin.");
  const notice = paidReportNotice("app.example", "https://vibecheck.example/scans/scan_1");
  assert.equal(notice.subject, "Your VibeCheck full report is ready");
  assert.match(notice.text, /The full report for app\.example is ready/);
  assert.match(notice.text, /https:\/\/vibecheck\.example\/scans\/scan_1/);
  assert.equal(containsToolBrand(`${notice.subject}\n${notice.text}`), null);

  assert.deepEqual(paidScanDashboardAction("preview", null, UPGRADE_ACTIONS.report), {
    href: "/scans/preview#upgrade",
    label: UPGRADE_ACTIONS.report,
  });
  assert.deepEqual(
    paidScanDashboardAction("preview", { status: "paid", ownershipBlock: null, startNote: null, fullScan: { id: "full", status: "running" } }, UPGRADE_ACTIONS.report),
    { href: "/scans/full", label: FULL_SCAN_PROGRESS_LABEL },
  );
  assert.deepEqual(
    paidScanDashboardAction("preview", { status: "paid", ownershipBlock: null, startNote: null, fullScan: { id: "full", status: "failed" } }, UPGRADE_ACTIONS.report),
    { href: "/scans/full", label: FULL_SCAN_STOPPED_LABEL },
  );
  assert.deepEqual(
    paidScanDashboardAction("preview", { status: "paid", ownershipBlock: null, startNote: null, fullScan: { id: "full", status: "completed" } }, UPGRADE_ACTIONS.report),
    { href: "/scans/full", label: OPEN_FULL_REPORT_LABEL },
  );
  assert.deepEqual(
    paidScanDashboardAction("preview", { status: "paid", ownershipBlock: null, startNote: null, fullScan: { id: "full", status: "awaiting_repo" }, tier: "rescan" }, UPGRADE_ACTIONS.report),
    { href: "/scans/full", label: CONNECT_GITHUB_CODE_SCAN_LABEL },
  );
  assert.deepEqual(
    paidScanDashboardAction("preview", { status: "paid", ownershipBlock: "Publish the token again.", startNote: null, fullScan: null }, UPGRADE_ACTIONS.report),
    { href: "/scans/preview#upgrade", label: REVERIFY_OWNERSHIP_LABEL },
  );
  assert.deepEqual(
    paidScanDashboardAction("preview", { status: "paid", ownershipBlock: null, startNote: "Wait for a running scan to finish before starting another.", fullScan: null }, UPGRADE_ACTIONS.report),
    { href: "/scans/preview#upgrade", label: START_FULL_SCAN_LABEL },
  );
  assert.deepEqual(
    paidScanDashboardAction(
      "preview",
      { status: "paid", ownershipBlock: null, startNote: null, fullScan: null, tier: "rescan", repoConnected: false, githubConfigured: true },
      UPGRADE_ACTIONS.report,
    ),
    { href: "/scans/preview#code-scan-step", label: CONNECT_GITHUB_CODE_SCAN_LABEL },
  );
  assert.equal(codeScanDashboardPrompt({ tier: "report", repoConnected: false, githubConfigured: true, previewId: "p", projectId: "proj", fullScan: null }), null);
  assert.equal(codeScanDashboardPrompt({ tier: "monitor", repoConnected: false, githubConfigured: true, previewId: "p", projectId: "proj", fullScan: null }), null);
  assert.equal(codeScanDashboardPrompt({ tier: "rescan", repoConnected: true, githubConfigured: true, previewId: "p", projectId: "proj", fullScan: null }), null);
  assert.equal(codeScanDashboardPrompt({ tier: "rescan", repoConnected: false, githubConfigured: false, previewId: "p", projectId: "proj", fullScan: null }), null);
  assert.deepEqual(codeScanDashboardPrompt({ tier: "rescan", repoConnected: false, githubConfigured: true, previewId: "p", projectId: "proj", fullScan: null }), {
    href: "/scans/p#code-scan-step",
    label: CONNECT_GITHUB_CODE_SCAN_LABEL,
  });
  assert.deepEqual(
    codeScanDashboardPrompt({ tier: "rescan", repoConnected: false, githubConfigured: true, previewId: "p", projectId: "proj", fullScan: { id: "full", status: "completed" } }),
    { href: "/scans/full#code-scan", label: CONNECT_GITHUB_CODE_SCAN_LABEL },
  );
  assert.deepEqual(
    codeScanDashboardPrompt({ tier: "rescan", repoConnected: true, githubConfigured: true, previewId: "p", projectId: "proj", fullScan: { id: "full", status: "awaiting_repo" } }),
    { href: "/scans/full", label: CONNECT_GITHUB_CODE_SCAN_LABEL },
  );
  assert.equal(
    codeScanDashboardPrompt({ tier: "report", repoConnected: false, githubConfigured: true, previewId: "p", projectId: "proj", fullScan: { id: "full", status: "awaiting_repo" } }),
    null,
  );
  assert.equal(CODE_REPO_STEP_TITLE, "Step 1: Connect your GitHub repo (read-only, one repo, deleted after scan)");
  assert.equal(SKIP_CODE_SCAN_LABEL, "Skip code scan, scan site only");
  assert.equal(CONNECT_GITHUB_CODE_SCAN_LABEL, "Connect GitHub to run your code scan");
  const step = readFileSync(path.join(process.cwd(), "src/components/CodeScanConnectStep.tsx"), "utf8");
  assert.match(step, /CODE_REPO_STEP_TITLE/);
  assert.match(step, /SKIP_CODE_SCAN_LABEL/);
  assert.match(step, /CODE_PRIVACY_PROMISE/);
  assert.match(step, /USE_THIS_REPO_LABEL/);
  assert.match(step, /CHANGE_REPO_LABEL/);
  assert.match(step, /Connect GitHub/);
  const dashboard = readFileSync(path.join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
  assert.match(dashboard, /codeScanDashboardPrompt/);
  assert.match(dashboard, /CONNECT_GITHUB_CODE_SCAN_LABEL|codeScanDashboardPrompt/);
  const progress = readFileSync(path.join(process.cwd(), "src/lib/scan-progress.ts"), "utf8");
  assert.match(progress, /Scanning your code/);

  const execute = readFileSync(path.join(process.cwd(), "src/worker/execute.ts"), "utf8");
  assert.match(execute, /"code"/);
  assert.match(execute, /notifyPaidReport/);
  assert.match(execute, /paidReportNotice/);
  assert.match(execute, /full report notice failed/);
  const preview = readFileSync(path.join(process.cwd(), "src/components/ReportView.tsx"), "utf8");
  assert.match(preview, /FULL_REPORT_PURCHASE_LEDE/);
  assert.match(preview, /PaidScanFollowup/);
});

test("a paid mini scan starts one full scan, blocks when proof is missing, and retries without a second charge", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { retryPaidFullScan } = await import("./paid-full-scan");
  const { user, project, scan, session } = await seed(prisma, "report");
  const enqueued: string[] = [];
  let ownershipOk = false;
  const deps: PaidFullScanDeps = {
    verifyOwnership: async () =>
      ownershipOk
        ? { ok: true, method: "dns_txt" }
        : { ok: false, reason: "Ownership proof was not found. Publish the token in DNS TXT or at /.well-known/vibecheck-verify.txt and try again." },
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  };

  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session), deps);
  const blocked = await prisma.purchase.findUniqueOrThrow({ where: { dodoCheckoutSession: session } });
  assert.equal(blocked.status, "paid");
  assert.equal(blocked.fullScanId, null);
  assert.match(blocked.ownershipBlock || "", /Ownership proof was not found/);
  assert.equal(blocked.ownershipBlock?.includes(project.ownershipToken), false);
  assert.equal(enqueued.length, 0);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reportCredits, 0);

  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session, "pay_again"), deps);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reportCredits, 0);

  ownershipOk = true;
  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session, "pay_third"), deps);
  assert.equal(enqueued.length, 1);
  const full = await prisma.scan.findFirstOrThrow({ where: { userId: user.id, mode: "full" } });
  assert.equal(full.status, "queued");
  assert.equal(full.reportAccess, "full");
  assert.equal(full.targetUrl, project.url);
  assert.equal(full.consentText, CONSENT_TEXT);
  assert.ok(full.consentAt);
  const linked = await prisma.purchase.findUniqueOrThrow({ where: { dodoCheckoutSession: session } });
  assert.equal(linked.fullScanId, full.id);
  assert.equal(linked.ownershipBlock, null);
  const authorizations = await prisma.scanAuthorization.findMany({ where: { scanId: full.id } });
  assert.equal(authorizations.filter((row) => row.kind === "consent" && row.method === "checkbox" && row.note === CONSENT_TEXT).length, 1);
  assert.equal(authorizations.filter((row) => row.kind === "ownership" && row.method === "dns_txt").length, 1);
  const stamped = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
  assert.equal(stamped.ownershipMethod, "dns_txt");
  assert.ok(stamped.ownershipVerifiedAt);

  await prisma.scan.update({ where: { id: full.id }, data: { status: "running", startedAt: new Date() } });
  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session, "pay_fourth"), deps);
  assert.equal(enqueued.length, 1);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  assert.equal((await prisma.scanAuthorization.count({ where: { scanId: full.id, kind: "consent" } })), 1);

  await prisma.scan.update({ where: { id: full.id }, data: { status: "failed", error: "The site did not respond.", finishedAt: new Date(), startedAt: null } });
  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session, "pay_fifth"), deps);
  assert.equal(enqueued.length, 1);
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: full.id } })).status, "failed");

  const retried = await retryPaidFullScan(user.id, linked.id, deps);
  if (retried.outcome !== "started") assert.fail(retried.outcome);
  assert.equal(retried.scanId, full.id);
  assert.equal(enqueued.length, 2);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  const rerun = await prisma.scan.findUniqueOrThrow({ where: { id: full.id } });
  assert.equal(rerun.status, "queued");
  assert.equal(rerun.error, null);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reportCredits, 0);

  await prisma.scan.update({ where: { id: full.id }, data: { status: "failed", error: "stopped", finishedAt: new Date() } });
  ownershipOk = false;
  const stillBlocked = await retryPaidFullScan(user.id, linked.id, deps);
  assert.equal(stillBlocked.outcome, "needs_ownership");
  assert.equal(enqueued.length, 2);
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: full.id } })).status, "failed");
  assert.match((await prisma.purchase.findUniqueOrThrow({ where: { id: linked.id } })).ownershipBlock || "", /Ownership proof/);

  await cleanup(prisma, user.id);
});

test("the $99 mini purchase adds one rescan credit and still one full scan", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { user, scan, session } = await seed(prisma, "rescan");
  let ownershipOk = false;
  const enqueued: string[] = [];
  const deps: PaidFullScanDeps = {
    githubConfigured: false,
    verifyOwnership: async () => (ownershipOk ? { ok: true, method: "well_known" } : { ok: false, reason: "Ownership proof was not found." }),
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  };
  await applyPaidAccess("dodo", paidEvent(user.id, "rescan", scan.id, session), deps);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reportCredits, 0);
  assert.equal(enqueued.length, 0);
  await applyPaidAccess("dodo", paidEvent(user.id, "rescan", scan.id, session, "pay_rescan_2"), deps);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);

  ownershipOk = true;
  await applyPaidAccess("dodo", paidEvent(user.id, "rescan", scan.id, session, "pay_rescan_3"), deps);
  assert.equal(enqueued.length, 1);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(buyer.rescanCredits, 1);
  assert.equal(buyer.codeReportCredits, 0);
  assert.equal(buyer.reportCredits, 0);
  const full = await prisma.scan.findFirstOrThrow({ where: { userId: user.id, mode: "full" } });
  assert.equal(full.status, "queued");
  assert.equal(full.codeScanEnabled, true);
  const ownership = await prisma.scanAuthorization.findFirstOrThrow({ where: { scanId: full.id, kind: "ownership" } });
  assert.equal(ownership.method, "well_known");
  await cleanup(prisma, user.id);
});

test("a full-mode teaser purchase unlocks stored access and does not enqueue", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { user, project, session } = await seed(prisma, "report");
  const scan = await prisma.scan.create({
    data: { projectId: project.id, userId: user.id, status: "completed", mode: "full", reportAccess: "teaser", targetUrl: project.url },
  });
  await prisma.purchase.update({ where: { dodoCheckoutSession: session }, data: { scanId: scan.id } });
  const enqueued: string[] = [];
  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session), {
    verifyOwnership: async () => {
      throw new Error("ownership should not be checked for a stored full scan");
    },
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  });
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).reportAccess, "full");
  assert.equal(enqueued.length, 0);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { dodoCheckoutSession: session } })).fullScanId, null);
  await cleanup(prisma, user.id);
});

test("a paid mini scan waits for a free slot and survives a queue outage without a second order", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { retryPaidFullScan } = await import("./paid-full-scan");
  const { user, project, scan, session, purchase } = await seed(prisma, "report");
  for (let index = 0; index < 3; index += 1) {
    await prisma.scan.create({
      data: { projectId: project.id, userId: user.id, status: "queued", mode: "full", reportAccess: "full", targetUrl: project.url, consentAt: new Date() },
    });
  }
  const deps: PaidFullScanDeps = {
    verifyOwnership: async () => ({ ok: true, method: "dns_txt" }),
    enqueueScan: async () => {
      throw new Error("queue unavailable");
    },
  };
  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session), deps);
  const limited = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
  assert.equal(limited.status, "paid");
  assert.equal(limited.fullScanId, null);
  assert.match(limited.startNote || "", /Wait for a running scan to finish/);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full", status: "queued" } }), 3);

  await prisma.scan.updateMany({ where: { userId: user.id, status: "queued" }, data: { status: "completed" } });
  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session, "pay_after_cap"), deps);
  const failed = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { fullScan: true } });
  assert.ok(failed.fullScanId);
  assert.equal(failed.fullScan?.status, "failed");
  assert.match(failed.fullScan?.error || "", /queue is unavailable/i);
  assert.equal(await prisma.scan.count({ where: { projectId: project.id, mode: "full", status: "failed" } }), 1);

  const enqueued: string[] = [];
  const retried = await retryPaidFullScan(user.id, purchase.id, {
    verifyOwnership: async () => ({ ok: true, method: "dns_txt" }),
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  });
  if (retried.outcome !== "started") assert.fail(retried.outcome);
  assert.equal(retried.scanId, failed.fullScanId);
  assert.deepEqual(enqueued, [failed.fullScanId]);
  await cleanup(prisma, user.id);
});

test("a $99 purchase waits to connect a repository when GitHub is configured, then one scan covers the site and the code", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { choosePaidCodeScan } = await import("./paid-full-scan");
  const { settlePreviewCheckout } = await import("./confirm-purchase");
  const { user, project, scan, session, purchase } = await seed(prisma, "rescan");
  const enqueued: string[] = [];
  const deps: PaidFullScanDeps = {
    githubConfigured: true,
    verifyOwnership: async () => ({ ok: true, method: "dns_txt" }),
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  };

  const waiting = await settlePreviewCheckout({
    purchase: { ...purchase, status: "pending" },
    query: { checkout: "success" },
    deps,
  });
  assert.equal(waiting.kind, "confirming");
  assert.equal(enqueued.length, 0);
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).status, "pending");

  await applyPaidAccess("dodo", paidEvent(user.id, "rescan", scan.id, session), deps);
  const held = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
  assert.equal(held.status, "paid");
  if (!held.fullScanId) assert.fail("missing full scan");
  assert.equal(held.codeScanChoice, null);
  assert.equal(enqueued.length, 0);
  const waitingScan = await prisma.scan.findUniqueOrThrow({ where: { id: held.fullScanId } });
  assert.equal(waitingScan.status, "awaiting_repo");
  assert.equal(waitingScan.codeScanEnabled, true);
  assert.equal(waitingScan.codeScanChoice, null);
  assert.equal(waitingScan.mode, "full");
  assert.equal(waitingScan.reportAccess, "full");
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(buyer.rescanCredits, 1);
  assert.equal(buyer.codeReportCredits, 0);
  assert.equal(buyer.reportCredits, 0);
  const stamped = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
  assert.equal(stamped.ownershipMethod, "dns_txt");
  assert.ok(stamped.ownershipVerifiedAt);

  await applyPaidAccess("dodo", paidEvent(user.id, "rescan", scan.id, session, "pay_while_waiting"), deps);
  assert.equal(enqueued.length, 0);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: held.fullScanId } })).status, "awaiting_repo");

  const blocked = await choosePaidCodeScan({ userId: user.id, purchaseId: purchase.id, choice: "connect", deps });
  if (blocked.outcome !== "needs_repo") assert.fail(blocked.outcome);
  assert.equal(blocked.scanId, held.fullScanId);
  assert.equal(enqueued.length, 0);
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: held.fullScanId } })).status, "awaiting_repo");

  await prisma.repoLink.create({
    data: { projectId: project.id, userId: user.id, installationId: "77", repoId: "88", owner: "acme", name: "app", status: "connected" },
  });
  const started = await choosePaidCodeScan({ userId: user.id, purchaseId: purchase.id, choice: "connect", deps });
  if (started.outcome !== "started") assert.fail(started.outcome);
  assert.equal(started.scanId, held.fullScanId);
  assert.deepEqual(enqueued, [started.scanId]);
  const full = await prisma.scan.findUniqueOrThrow({ where: { id: started.scanId } });
  assert.equal(full.codeScanEnabled, true);
  assert.equal(full.codeRepoOwner, "acme");
  assert.equal(full.codeRepoName, "app");
  assert.equal(full.codeRepoInstallationId, "77");
  assert.equal(full.mode, "full");
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).codeScanChoice, "connect");
  await applyPaidAccess("dodo", paidEvent(user.id, "rescan", scan.id, session, "pay_again"), deps);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);
  await cleanup(prisma, user.id);
});

test("skipping the code step still runs the paid site scan and keeps the code scan on the same purchase", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { choosePaidCodeScan } = await import("./paid-full-scan");
  const { user, scan, session, purchase } = await seed(prisma, "rescan");
  const enqueued: string[] = [];
  const deps: PaidFullScanDeps = {
    githubConfigured: true,
    verifyOwnership: async () => ({ ok: true, method: "well_known" }),
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  };
  await applyPaidAccess("dodo", paidEvent(user.id, "rescan", scan.id, session), deps);
  assert.equal(enqueued.length, 0);
  const held = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
  if (!held.fullScanId) assert.fail("missing full scan");
  assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: held.fullScanId } })).status, "awaiting_repo");
  const skipped = await choosePaidCodeScan({ userId: user.id, purchaseId: purchase.id, choice: "skip", deps });
  if (skipped.outcome !== "started") assert.fail(skipped.outcome);
  assert.equal(skipped.scanId, held.fullScanId);
  const full = await prisma.scan.findUniqueOrThrow({ where: { id: skipped.scanId } });
  assert.equal(full.status, "queued");
  assert.equal(full.codeScanEnabled, true);
  assert.equal(full.codeScanChoice, "skip");
  assert.equal(full.codeRepoOwner, null);
  assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).codeScanChoice, "skip");
  assert.equal(await prisma.purchase.count({ where: { userId: user.id } }), 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);
  await cleanup(prisma, user.id);
});

test("a $49 purchase still starts immediately when GitHub is configured", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { user, scan, session } = await seed(prisma, "report");
  const enqueued: string[] = [];
  await applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session), {
    githubConfigured: true,
    verifyOwnership: async () => ({ ok: true, method: "dns_txt" }),
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  });
  assert.equal(enqueued.length, 1);
  const full = await prisma.scan.findFirstOrThrow({ where: { userId: user.id, mode: "full" } });
  assert.equal(full.status, "queued");
  assert.equal(full.codeScanEnabled, false);
  await cleanup(prisma, user.id);
});

test("two payment events for one mini order leave a single full scan", { skip }, async () => {
  const { prisma } = await import("../db");
  const { applyPaidAccess } = await import("./fulfill");
  const { user, scan, session } = await seed(prisma, "report");
  const enqueued: string[] = [];
  const deps: PaidFullScanDeps = {
    verifyOwnership: async () => ({ ok: true, method: "dns_txt" }),
    enqueueScan: async (scanId) => {
      enqueued.push(scanId);
    },
  };
  await Promise.all([
    applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session, "pay_a"), deps),
    applyPaidAccess("dodo", paidEvent(user.id, "report", scan.id, session, "pay_b"), deps),
  ]);
  assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  assert.equal(new Set(enqueued).size, 1);
  await cleanup(prisma, user.id);
});

after(async () => {
  if (!databaseUrl) return;
  const { prisma } = await import("../db");
  await prisma.$disconnect();
});

async function seed(prisma: Awaited<typeof import("../db")>["prisma"], tier: "report" | "rescan") {
  const suffix = randomBytes(4).toString("hex");
  const user = await prisma.user.create({ data: { email: `paid-full-${suffix}@example.com` } });
  const project = await prisma.project.create({
    data: { userId: user.id, url: "http://127.0.0.1:4010", host: "127.0.0.1:4010", ownershipToken: `vc_${suffix}` },
  });
  const scan = await prisma.scan.create({
    data: {
      projectId: project.id,
      userId: user.id,
      status: "completed",
      mode: "mini",
      reportAccess: "full",
      targetUrl: project.url,
      consentAt: new Date(),
      consentText: "preview",
    },
  });
  const session = `cks_${tier}_${suffix}`;
  const purchase = await prisma.purchase.create({
    data: { userId: user.id, scanId: scan.id, tier, status: "pending", dodoCheckoutSession: session },
  });
  return { user, project, scan, purchase, session, suffix };
}

function paidEvent(userId: string, tier: "report" | "rescan", scanId: string, sessionId: string, paymentId = "pay_once") {
  return {
    action: "payment_succeeded" as const,
    id: paymentId,
    type: "payment.succeeded",
    userId,
    tier,
    scanId,
    sessionId,
    paymentId,
    subscriptionId: null,
    customerId: null,
  };
}

async function cleanup(prisma: Awaited<typeof import("../db")>["prisma"], userId: string) {
  await prisma.scanAuthorization.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

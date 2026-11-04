import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { AWAITING_REPO_STATUS } from "./gate";
import { stagesForMode } from "@/lib/scan-progress";

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : "DATABASE_URL is not set";

test("credit scan wiring holds a missing repository and shows the connect step", () => {
  const route = readFileSync(path.join(process.cwd(), "src/app/api/projects/[id]/verify/route.ts"), "utf8");
  const accessAt = route.indexOf("takeReportAccess(");
  const openAt = route.indexOf("openHeldOrQueuedScan(");
  const settleAt = route.indexOf("settleVerifiedScan(");
  const needsAt = route.indexOf("needsRepo: true");
  assert.ok(accessAt > 0 && openAt > accessAt && settleAt > openAt && needsAt > settleAt);
  assert.equal(route.includes("enqueueScan"), false);
  assert.match(route, /githubAppConfig\(\) !== null/);
  assert.match(route, /repoIsConnected\(project\.repoLink\)/);

  const page = readFileSync(path.join(process.cwd(), "src/app/scans/[id]/page.tsx"), "utf8");
  assert.match(page, /shouldOfferCreditCodeStep/);
  assert.match(page, /creditCodeStep/);
  assert.match(page, /scanId=\{scan\.id\}/);
  assert.match(page, /codeScan=\{Boolean\(scan\.codeScanEnabled && scan\.codeScanChoice !== "skip" && connectedRepo\)\}/);
  assert.match(page, /codeScanRepoLabel\(connectedRepo\)/);

  const form = readFileSync(path.join(process.cwd(), "src/components/NewScanForm.tsx"), "utf8");
  assert.match(form, /needsRepo/);
  assert.match(form, /\/scans\/\$\{data\.scanId\}/);

  const step = readFileSync(path.join(process.cwd(), "src/components/CodeScanConnectStep.tsx"), "utf8");
  assert.match(step, /\/api\/scans\/\$\{scanId\}\/code-choice/);
  assert.match(step, /SKIP_CODE_SCAN_LABEL/);
  assert.match(step, /Connect GitHub/);

  const choice = readFileSync(path.join(process.cwd(), "src/app/api/scans/[id]/code-choice/route.ts"), "utf8");
  assert.match(choice, /chooseHeldCreditScan/);
  const callback = readFileSync(path.join(process.cwd(), "src/app/api/github/callback/route.ts"), "utf8");
  const select = readFileSync(path.join(process.cwd(), "src/app/api/github/select/route.ts"), "utf8");
  assert.match(callback, /resumeHeldCreditScanAfterRepo/);
  assert.match(select, /resumeHeldCreditScanAfterRepo/);

  assert.equal(stagesForMode("full", { codeScan: true }).some((stage) => stage.label === "Scanning your code"), true);
  assert.equal(stagesForMode("full", { codeScan: false }).some((stage) => stage.label === "Scanning your code"), false);
});

test("a rescan credit without a repository is not queued, and skip queues it once", { skip }, async () => {
  const { prisma } = await import("../db");
  const { takeReportAccess } = await import("../entitlements");
  const { codeScanEnabledForCredit } = await import("./gate");
  const { chooseHeldCreditScan, openHeldOrQueuedScan, settleVerifiedScan } = await import("./held-scan");
  const { user, project } = await seed(prisma);
  const enqueued: string[] = [];
  try {
    await prisma.user.update({ where: { id: user.id }, data: { rescanCredits: 2 } });
    const started = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: true,
      repoConnected: false,
      enqueue: async (scanId) => {
        enqueued.push(scanId);
      },
    });
    assert.equal(started.settled.needsRepo, true);
    assert.deepEqual(enqueued, []);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);
    const held = await prisma.scan.findUniqueOrThrow({ where: { id: started.scanId } });
    assert.equal(held.status, AWAITING_REPO_STATUS);
    assert.equal(held.codeScanChoice, null);
    assert.equal(held.codeScanEnabled, true);
    assert.equal(held.mode, "full");
    assert.equal(held.reportAccess, "full");
    assert.equal(await prisma.scan.count({ where: { userId: user.id, status: { in: ["queued", "running"] } } }), 0);

    const skipped = await chooseHeldCreditScan({
      userId: user.id,
      scanId: started.scanId,
      choice: "skip",
      deps: { enqueueScan: async (scanId) => void enqueued.push(scanId) },
    });
    if (skipped.outcome !== "started") assert.fail(skipped.outcome);
    assert.deepEqual(enqueued, [started.scanId]);
    const released = await prisma.scan.findUniqueOrThrow({ where: { id: started.scanId } });
    assert.equal(released.status, "queued");
    assert.equal(released.codeScanChoice, "skip");
    assert.equal(released.codeScanEnabled, true);

    const again = await chooseHeldCreditScan({
      userId: user.id,
      scanId: started.scanId,
      choice: "skip",
      deps: { enqueueScan: async (scanId) => void enqueued.push(scanId) },
    });
    assert.equal(again.outcome, "already_started");
    assert.deepEqual(enqueued, [started.scanId]);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);
    assert.equal(await prisma.scan.count({ where: { userId: user.id, mode: "full" } }), 1);
  } finally {
    await cleanup(prisma, user.id);
  }
});

test("connecting a repository queues a held credit scan once", { skip }, async () => {
  const { prisma } = await import("../db");
  const { takeReportAccess } = await import("../entitlements");
  const { codeScanEnabledForCredit } = await import("./gate");
  const { chooseHeldCreditScan, openHeldOrQueuedScan, resumeHeldCreditScanAfterRepo, settleVerifiedScan } = await import("./held-scan");
  const { user, project } = await seed(prisma);
  const enqueued: string[] = [];
  const enqueueScan = async (scanId: string) => {
    enqueued.push(scanId);
  };
  try {
    await prisma.user.update({ where: { id: user.id }, data: { rescanCredits: 2 } });
    const started = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: true,
      repoConnected: false,
      enqueue: enqueueScan,
    });
    assert.equal(started.settled.needsRepo, true);
    assert.deepEqual(enqueued, []);

    const blocked = await chooseHeldCreditScan({
      userId: user.id,
      scanId: started.scanId,
      choice: "connect",
      deps: { enqueueScan },
    });
    assert.equal(blocked.outcome, "needs_repo");
    assert.equal(await resumeHeldCreditScanAfterRepo(user.id, project.id, { enqueueScan }), null);
    assert.deepEqual(enqueued, []);
    assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: started.scanId } })).status, AWAITING_REPO_STATUS);
    assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: started.scanId } })).codeScanChoice, null);

    await prisma.repoLink.create({
      data: { projectId: project.id, userId: user.id, installationId: "77", repoId: "88", owner: "acme", name: "app", status: "connected" },
    });
    const resumed = await resumeHeldCreditScanAfterRepo(user.id, project.id, { enqueueScan });
    assert.deepEqual(resumed, { scanId: started.scanId });
    assert.deepEqual(enqueued, [started.scanId]);
    const released = await prisma.scan.findUniqueOrThrow({ where: { id: started.scanId } });
    assert.equal(released.status, "queued");
    assert.equal(released.codeScanChoice, "connect");
    assert.equal(released.codeScanEnabled, true);

    assert.equal(await resumeHeldCreditScanAfterRepo(user.id, project.id, { enqueueScan }), null);
    const again = await chooseHeldCreditScan({
      userId: user.id,
      scanId: started.scanId,
      choice: "connect",
      deps: { enqueueScan },
    });
    assert.equal(again.outcome, "already_started");
    assert.deepEqual(enqueued, [started.scanId]);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);
  } finally {
    await cleanup(prisma, user.id);
  }
});

test("two skip requests queue one held credit scan", { skip }, async () => {
  const { prisma } = await import("../db");
  const { takeReportAccess } = await import("../entitlements");
  const { codeScanEnabledForCredit } = await import("./gate");
  const { chooseHeldCreditScan, openHeldOrQueuedScan, settleVerifiedScan } = await import("./held-scan");
  const { user, project } = await seed(prisma);
  const enqueued: string[] = [];
  const enqueueScan = async (scanId: string) => {
    enqueued.push(scanId);
  };
  try {
    await prisma.user.update({ where: { id: user.id }, data: { rescanCredits: 1 } });
    const started = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: true,
      repoConnected: false,
      enqueue: enqueueScan,
    });
    const [first, second] = await Promise.all([
      chooseHeldCreditScan({ userId: user.id, scanId: started.scanId, choice: "skip", deps: { enqueueScan } }),
      chooseHeldCreditScan({ userId: user.id, scanId: started.scanId, choice: "skip", deps: { enqueueScan } }),
    ]);
    assert.deepEqual([first.outcome, second.outcome].sort(), ["already_started", "started"]);
    assert.deepEqual(enqueued, [started.scanId]);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 0);
  } finally {
    await cleanup(prisma, user.id);
  }
});

test("a connected repository still waits for confirmation, and a server without GitHub queues immediately", { skip }, async () => {
  const { prisma } = await import("../db");
  const { takeReportAccess } = await import("../entitlements");
  const { codeScanEnabledForCredit } = await import("./gate");
  const { chooseHeldCreditScan, openHeldOrQueuedScan, settleVerifiedScan } = await import("./held-scan");
  const { user, project } = await seed(prisma);
  const enqueued: string[] = [];
  const enqueueScan = async (scanId: string) => {
    enqueued.push(scanId);
  };
  try {
    await prisma.user.update({ where: { id: user.id }, data: { rescanCredits: 3, reportCredits: 1 } });
    await prisma.repoLink.create({
      data: { projectId: project.id, userId: user.id, installationId: "77", repoId: "88", owner: "acme", name: "app", status: "connected" },
    });
    const connected = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: true,
      repoConnected: true,
      enqueue: enqueueScan,
    });
    assert.equal(connected.settled.needsRepo, true);
    assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: connected.scanId } })).status, "awaiting_repo");
    const released = await chooseHeldCreditScan({
      userId: user.id,
      scanId: connected.scanId,
      choice: "connect",
      deps: { enqueueScan },
    });
    assert.equal(released.outcome, "started");
    const locked = await prisma.scan.findUniqueOrThrow({ where: { id: connected.scanId } });
    assert.equal(locked.codeRepoOwner, "acme");
    assert.equal(locked.codeRepoName, "app");
    assert.equal(locked.codeRepoInstallationId, "77");
    assert.equal(locked.status, "queued");

    await prisma.repoLink.delete({ where: { projectId: project.id } });
    const unconfigured = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: false,
      repoConnected: false,
      enqueue: enqueueScan,
    });
    assert.equal(unconfigured.settled.needsRepo, false);
    assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: unconfigured.scanId } })).status, "queued");

    const report = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: true,
      repoConnected: false,
      use: "credit",
      enqueue: enqueueScan,
    });
    assert.equal(report.codeScanEnabled, false);
    assert.equal(report.settled.needsRepo, false);
    assert.deepEqual(enqueued, [connected.scanId, unconfigured.scanId, report.scanId]);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).rescanCredits, 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reportCredits, 0);
  } finally {
    await cleanup(prisma, user.id);
  }
});

test("a $99 full-report credit waits for GitHub and a $49 credit does not", { skip }, async () => {
  const { prisma } = await import("../db");
  const { takeReportAccess } = await import("../entitlements");
  const { codeScanEnabledForCredit } = await import("./gate");
  const { openHeldOrQueuedScan, settleVerifiedScan } = await import("./held-scan");
  const { user, project } = await seed(prisma);
  const enqueued: string[] = [];
  const enqueue = async (scanId: string) => {
    enqueued.push(scanId);
  };
  try {
    await prisma.user.update({ where: { id: user.id }, data: { codeReportCredits: 1, reportCredits: 1 } });
    await prisma.repoLink.create({
      data: { projectId: project.id, userId: user.id, installationId: "77", repoId: "88", owner: "acme", name: "app", status: "connected" },
    });
    const code = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: true,
      repoConnected: true,
      use: "code-credit",
      enqueue,
    });
    assert.equal(code.codeScanEnabled, true);
    assert.equal(code.settled.needsRepo, true);
    assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: code.scanId } })).status, AWAITING_REPO_STATUS);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).codeReportCredits, 0);

    const report = await startCreditScan({
      prisma,
      takeReportAccess,
      codeScanEnabledForCredit,
      openHeldOrQueuedScan,
      settleVerifiedScan,
      userId: user.id,
      projectId: project.id,
      targetUrl: project.url,
      githubConfigured: true,
      repoConnected: true,
      use: "credit",
      enqueue,
    });
    assert.equal(report.codeScanEnabled, false);
    assert.equal(report.settled.needsRepo, false);
    assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: report.scanId } })).status, "queued");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reportCredits, 0);
    assert.deepEqual(enqueued, [report.scanId]);
  } finally {
    await cleanup(prisma, user.id);
  }
});

after(async () => {
  if (!databaseUrl) return;
  const { prisma } = await import("../db");
  await prisma.$disconnect();
});

async function startCreditScan(input: {
  prisma: Awaited<typeof import("../db")>["prisma"];
  takeReportAccess: typeof import("../entitlements").takeReportAccess;
  codeScanEnabledForCredit: typeof import("./gate").codeScanEnabledForCredit;
  openHeldOrQueuedScan: typeof import("./held-scan").openHeldOrQueuedScan;
  settleVerifiedScan: typeof import("./held-scan").settleVerifiedScan;
  userId: string;
  projectId: string;
  targetUrl: string;
  githubConfigured: boolean;
  repoConnected: boolean;
  use?: "rescan" | "credit" | "code-credit";
  enqueue: (scanId: string) => Promise<void>;
}) {
  const use = input.use ?? "rescan";
  const access = await input.takeReportAccess(input.userId, use);
  const codeScanEnabled = input.codeScanEnabledForCredit({ mode: "full", use, spentRescanCredit: access.spentRescanCredit });
  const opened = await input.openHeldOrQueuedScan({
    userId: input.userId,
    projectId: input.projectId,
    mode: "full",
    reportAccess: access.access,
    codeScanEnabled,
    targetUrl: input.targetUrl,
    githubConfigured: input.githubConfigured,
    repoConnected: input.repoConnected,
  });
  const settled = await input.settleVerifiedScan({
    scanId: opened.scanId,
    needsRepo: opened.needsRepo,
    enqueueScan: input.enqueue,
  });
  return { scanId: opened.scanId, settled, codeScanEnabled };
}

async function seed(prisma: Awaited<typeof import("../db")>["prisma"]) {
  const suffix = randomBytes(4).toString("hex");
  const user = await prisma.user.create({ data: { email: `held-scan-${suffix}@example.com` } });
  const project = await prisma.project.create({
    data: { userId: user.id, url: `http://127.0.0.1:4010/${suffix}`, host: "127.0.0.1:4010", ownershipToken: `vc_${suffix}` },
  });
  return { user, project };
}

async function cleanup(prisma: Awaited<typeof import("../db")>["prisma"], userId: string) {
  await prisma.scanAuthorization.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

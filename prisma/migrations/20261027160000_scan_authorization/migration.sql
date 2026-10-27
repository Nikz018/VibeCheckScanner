-- CreateTable
CREATE TABLE "ScanAuthorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "projectId" TEXT,
    "scanId" TEXT,
    "targetUrl" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanAuthorization_host_idx" ON "ScanAuthorization"("host");

-- CreateIndex
CREATE INDEX "ScanAuthorization_userId_idx" ON "ScanAuthorization"("userId");

-- CreateIndex
CREATE INDEX "ScanAuthorization_createdAt_idx" ON "ScanAuthorization"("createdAt");

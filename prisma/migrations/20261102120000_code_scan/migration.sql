-- AlterTable
ALTER TABLE "Scan" ADD COLUMN "codeScanEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "codeReport" JSONB;

-- CreateTable
CREATE TABLE "RepoLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL DEFAULT '',
    "owner" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoLink_projectId_key" ON "RepoLink"("projectId");

-- CreateIndex
CREATE INDEX "RepoLink_userId_idx" ON "RepoLink"("userId");

-- CreateIndex
CREATE INDEX "RepoLink_installationId_idx" ON "RepoLink"("installationId");

-- AddForeignKey
ALTER TABLE "RepoLink" ADD CONSTRAINT "RepoLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoLink" ADD CONSTRAINT "RepoLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

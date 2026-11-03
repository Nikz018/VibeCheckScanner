-- The repository chosen for one paid code scan. A later connection does not retarget this scan.
ALTER TABLE "Scan" ADD COLUMN "codeRepoOwner" TEXT;
ALTER TABLE "Scan" ADD COLUMN "codeRepoName" TEXT;
ALTER TABLE "Scan" ADD COLUMN "codeRepoBranch" TEXT;
ALTER TABLE "Scan" ADD COLUMN "codeRepoInstallationId" TEXT;
ALTER TABLE "Scan" ADD COLUMN "codeRepoId" TEXT;

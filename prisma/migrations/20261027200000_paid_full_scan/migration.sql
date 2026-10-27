-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "fullScanId" TEXT,
ADD COLUMN "ownershipBlock" TEXT,
ADD COLUMN "startNote" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_fullScanId_key" ON "Purchase"("fullScanId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_fullScanId_fkey" FOREIGN KEY ("fullScanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

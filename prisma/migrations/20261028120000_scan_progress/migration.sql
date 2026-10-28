-- AlterTable
ALTER TABLE "Scan" ADD COLUMN "progressStage" TEXT,
ADD COLUMN "pagesDiscovered" INTEGER NOT NULL DEFAULT 0;

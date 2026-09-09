-- AlterTable
ALTER TABLE "payment_reports" ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "support_cases" ADD COLUMN     "caseNumber" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "externalPlatformUrl" TEXT,
    "infoPdfDriveFileId" TEXT,
    "infoPdfDriveFolderId" TEXT,
    "infoPdfFileName" TEXT,
    "infoPdfMimeType" TEXT,
    "infoPdfSizeBytes" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_cases_caseNumber_key" ON "support_cases"("caseNumber");


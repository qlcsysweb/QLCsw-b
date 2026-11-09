-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SYSTEM', 'MANUAL');

-- AlterTable
ALTER TABLE "admin_profiles" ADD COLUMN     "isGeneralAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "api_subaccounts" ADD COLUMN     "isPrincipal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "expirationAlertSentAt" TIMESTAMP(3),
ADD COLUMN     "expirationDate" TIMESTAMP(3),
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "month" INTEGER,
ADD COLUMN     "periodLabel" TEXT,
ADD COLUMN     "year" INTEGER;

-- AlterTable
ALTER TABLE "statements" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "supportCaseId" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "senderUserId" TEXT;

-- CreateTable
CREATE TABLE "security_configuration" (
    "id" TEXT NOT NULL,
    "clientDeletionPasswordHash" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_configuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_steps" (
    "id" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "titleEs" TEXT NOT NULL,
    "titleEn" TEXT,
    "descriptionEs" TEXT,
    "descriptionEn" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_distribution_reports" (
    "id" TEXT NOT NULL,
    "apiSubaccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" "PaymentReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_distribution_reports_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "security_configuration" ADD CONSTRAINT "security_configuration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "support_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_steps" ADD CONSTRAINT "process_steps_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_distribution_reports" ADD CONSTRAINT "capital_distribution_reports_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_distribution_reports" ADD CONSTRAINT "capital_distribution_reports_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


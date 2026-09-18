-- AUDITORIA QLC (16 partes) --

-- AlterEnum
ALTER TYPE "PaymentReportStatus" ADD VALUE 'GARANTIA_REPORTADA';

-- AlterTable
ALTER TABLE "payment_reports" ADD COLUMN     "guaranteeReportedAt" TIMESTAMP(3),
ADD COLUMN     "guaranteeReportedByUserId" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "emailSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "emailError" TEXT;

-- CreateTable
CREATE TABLE "support_case_messages" (
    "id" TEXT NOT NULL,
    "supportCaseId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_case_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_configuration" (
    "id" TEXT NOT NULL,
    "gmailUser" TEXT,
    "gmailAppPasswordEncrypted" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "configuredByUserId" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_configuration_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_guaranteeReportedByUserId_fkey" FOREIGN KEY ("guaranteeReportedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case_messages" ADD CONSTRAINT "support_case_messages_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "support_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case_messages" ADD CONSTRAINT "support_case_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_configuration" ADD CONSTRAINT "email_configuration_configuredByUserId_fkey" FOREIGN KEY ("configuredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_configuration" ADD CONSTRAINT "email_configuration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

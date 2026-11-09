-- CreateEnum
CREATE TYPE "CapitalInvitationStatus" AS ENUM ('DESBLOQUEADA', 'ACEPTADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "CapitalRequestStatus" AS ENUM ('EN_PROCESO', 'DISTRIBUCION_EN_PROCESO', 'INSTRUCCIONES_EMITIDAS', 'COMPLETADA');

-- AlterEnum
ALTER TYPE "ProcessConditionType" ADD VALUE 'WALLET';

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN     "nationality" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "statementId" TEXT;

-- AlterTable
ALTER TABLE "statements" ADD COLUMN     "netResult" DECIMAL(14,2),
ADD COLUMN     "volatility" TEXT;

-- CreateTable
CREATE TABLE "capital_increase_invitations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "currentBalance" DECIMAL(14,2) NOT NULL,
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "validityDays" INTEGER NOT NULL DEFAULT 10,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "CapitalInvitationStatus" NOT NULL DEFAULT 'DESBLOQUEADA',
    "respondedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_increase_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_increase_requests" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "status" "CapitalRequestStatus" NOT NULL DEFAULT 'EN_PROCESO',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "capital_increase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_distributions" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_distribution_items" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "apiSubaccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "capital_distribution_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "capital_increase_requests_invitationId_key" ON "capital_increase_requests"("invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "capital_distributions_requestId_key" ON "capital_distributions"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "statements_apiSubaccountId_periodStart_periodEnd_key" ON "statements"("apiSubaccountId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "capital_increase_invitations" ADD CONSTRAINT "capital_increase_invitations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_increase_invitations" ADD CONSTRAINT "capital_increase_invitations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_increase_requests" ADD CONSTRAINT "capital_increase_requests_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "capital_increase_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_distributions" ADD CONSTRAINT "capital_distributions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "capital_increase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_distribution_items" ADD CONSTRAINT "capital_distribution_items_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "capital_distributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_distribution_items" ADD CONSTRAINT "capital_distribution_items_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;


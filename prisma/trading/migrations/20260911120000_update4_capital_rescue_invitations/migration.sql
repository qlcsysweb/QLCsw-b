-- CreateEnum
CREATE TYPE "RescueInvitationStatus" AS ENUM ('DESBLOQUEADA', 'ACEPTADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "RescueParticipationStatus" AS ENUM ('EN_PROCESO', 'PENDIENTE_DE_DEPOSITO', 'EN_UTILIZACION', 'DISPONIBLE_PARA_DEVOLUCION', 'FINALIZADA');

-- CreateTable
CREATE TABLE "capital_rescue_invitations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "apiSubaccountId" TEXT,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "dailyRate" DECIMAL(6,3) NOT NULL,
    "validityDays" INTEGER NOT NULL DEFAULT 10,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT,
    "status" "RescueInvitationStatus" NOT NULL DEFAULT 'DESBLOQUEADA',
    "respondedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_rescue_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_rescue_participations" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "participationAmount" DECIMAL(14,2) NOT NULL,
    "status" "RescueParticipationStatus" NOT NULL DEFAULT 'EN_PROCESO',
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depositConfirmedAt" TIMESTAMP(3),
    "usageEndedAt" TIMESTAMP(3),
    "remunerationAmount" DECIMAL(14,2),
    "remunerationWallet" TEXT,
    "remunerationTxHash" TEXT,
    "remunerationPaidAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "comprobantePdfDriveFileId" TEXT,
    "comprobantePdfDriveFolderId" TEXT,
    "comprobantePdfFileName" TEXT,

    CONSTRAINT "capital_rescue_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_rescue_distributions" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_rescue_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_rescue_distribution_items" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "apiSubaccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "capital_rescue_distribution_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "capital_rescue_participations_invitationId_key" ON "capital_rescue_participations"("invitationId");

-- CreateIndex
CREATE UNIQUE INDEX "capital_rescue_distributions_participationId_key" ON "capital_rescue_distributions"("participationId");

-- AddForeignKey
ALTER TABLE "capital_rescue_invitations" ADD CONSTRAINT "capital_rescue_invitations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_rescue_invitations" ADD CONSTRAINT "capital_rescue_invitations_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_rescue_invitations" ADD CONSTRAINT "capital_rescue_invitations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_rescue_participations" ADD CONSTRAINT "capital_rescue_participations_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "capital_rescue_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_rescue_distributions" ADD CONSTRAINT "capital_rescue_distributions_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "capital_rescue_participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_rescue_distribution_items" ADD CONSTRAINT "capital_rescue_distribution_items_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "capital_rescue_distributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_rescue_distribution_items" ADD CONSTRAINT "capital_rescue_distribution_items_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


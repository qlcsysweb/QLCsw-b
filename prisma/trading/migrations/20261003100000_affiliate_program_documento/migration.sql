-- QLC AFFILIATE PROGRAM (documento funcional). Migracion NO destructiva: solo agrega columnas, tablas, tipos e indices.
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "affiliateBitgetUid" VARCHAR(40);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "affiliateBitgetUidUpdatedAt" TIMESTAMP(3);

ALTER TABLE "affiliate_configuration" ADD COLUMN IF NOT EXISTS "clientSharePct" DECIMAL(5,2) NOT NULL DEFAULT 50;
ALTER TABLE "affiliate_configuration" ADD COLUMN IF NOT EXISTS "qlcSharePct" DECIMAL(5,2) NOT NULL DEFAULT 40;
ALTER TABLE "affiliate_configuration" ADD COLUMN IF NOT EXISTS "affiliateSharePct" DECIMAL(5,2) NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS "affiliate_configuration_history" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "clientSharePct" DECIMAL(5,2) NOT NULL,
    "qlcSharePct" DECIMAL(5,2) NOT NULL,
    "affiliateSharePct" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "affiliate_configuration_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "clientSharePct" DECIMAL(5,2);
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "qlcSharePct" DECIMAL(5,2);
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "affiliateSharePct" DECIMAL(5,2);
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "clientResultAmount" DECIMAL(14,2);
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "qlcCommissionAmount" DECIMAL(14,2);
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "affiliateCommissionAmount" DECIMAL(14,2);
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "affiliateReferrerClientId" TEXT;

CREATE TYPE "AffiliatePaymentStatus" AS ENUM ('PENDIENTE', 'PROCESADO', 'PAGADO', 'RECHAZADO');
CREATE TABLE IF NOT EXISTS "affiliate_payments" (
    "id" TEXT NOT NULL,
    "referrerClientId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "periodLabel" VARCHAR(120) NOT NULL,
    "destinationUid" VARCHAR(40),
    "reference" VARCHAR(200),
    "proofDriveFileId" TEXT,
    "proofFileName" TEXT,
    "proofMimeType" TEXT,
    "status" "AffiliatePaymentStatus" NOT NULL DEFAULT 'PENDIENTE',
    "statusUpdatedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "affiliate_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "affiliate_payments_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "affiliate_payments_referrerClientId_status_idx" ON "affiliate_payments"("referrerClientId", "status");
ALTER TABLE "affiliate_payments" ADD CONSTRAINT "affiliate_payments_referrerClientId_fkey" FOREIGN KEY ("referrerClientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "statementId" TEXT;
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "periodStart" TIMESTAMP(3);
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "periodEnd" TIMESTAMP(3);
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_commissions_statementId_key" ON "affiliate_commissions"("statementId");
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "affiliate_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

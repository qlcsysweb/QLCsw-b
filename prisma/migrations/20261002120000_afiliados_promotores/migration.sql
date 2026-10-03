-- AFILIADOS / PROMOTORES (relación directa, no multinivel). Migración NO destructiva: solo agrega tipos, columnas, tablas e índices.
CREATE TYPE "AffiliateCommissionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'PAGADA', 'CANCELADA');

-- Clientes existentes: sin código y sin afiliador (NULL es válido, no se inventan relaciones).
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "affiliateCode" VARCHAR(32);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "affiliateEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "affiliateEnabledAt" TIMESTAMP(3);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "affiliateDisabledAt" TIMESTAMP(3);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "referredByClientId" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "referredAt" TIMESTAMP(3);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "referralSource" VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS "client_profiles_affiliateCode_key" ON "client_profiles"("affiliateCode");
CREATE INDEX IF NOT EXISTS "client_profiles_referredByClientId_idx" ON "client_profiles"("referredByClientId");
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_referredByClientId_fkey" FOREIGN KEY ("referredByClientId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Integridad: un cliente nunca puede ser su propio afiliador y el código siempre en mayúsculas A-Z0-9.
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_no_self_referral" CHECK ("referredByClientId" IS NULL OR "referredByClientId" <> "id");
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_affiliate_code_format" CHECK ("affiliateCode" IS NULL OR "affiliateCode" ~ '^[A-Z0-9]{3,32}$');

CREATE TABLE IF NOT EXISTS "affiliate_configuration" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "commissionType" "AffiliateCommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "commissionValue" DECIMAL(14,4),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "affiliate_configuration_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "affiliate_configuration" ADD CONSTRAINT "affiliate_configuration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "affiliate_commissions" (
    "id" TEXT NOT NULL,
    "referrerClientId" TEXT NOT NULL,
    "referredClientId" TEXT NOT NULL,
    "concept" VARCHAR(200) NOT NULL,
    "baseAmount" DECIMAL(14,2),
    "commissionType" "AffiliateCommissionType",
    "commissionValue" DECIMAL(14,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'PENDIENTE',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "affiliate_commissions_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "affiliate_commissions_distinct_clients" CHECK ("referrerClientId" <> "referredClientId")
);
CREATE INDEX IF NOT EXISTS "affiliate_commissions_referrerClientId_status_idx" ON "affiliate_commissions"("referrerClientId", "status");
CREATE INDEX IF NOT EXISTS "affiliate_commissions_referredClientId_idx" ON "affiliate_commissions"("referredClientId");
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_referrerClientId_fkey" FOREIGN KEY ("referrerClientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_referredClientId_fkey" FOREIGN KEY ("referredClientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "affiliate_audit_logs" (
    "id" TEXT NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "clientId" TEXT,
    "actorUserId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "affiliate_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "affiliate_audit_logs_clientId_idx" ON "affiliate_audit_logs"("clientId");

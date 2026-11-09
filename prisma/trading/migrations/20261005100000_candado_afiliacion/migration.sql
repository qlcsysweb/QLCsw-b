-- Candado de afiliación: quien se inscribió con la liga de un afiliador solo puede reinscribirse con la liga original.
CREATE TABLE IF NOT EXISTS "affiliate_referral_locks" (
  "id" TEXT NOT NULL,
  "referredClientId" TEXT,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "fullNameNormalized" TEXT NOT NULL,
  "referrerClientId" TEXT,
  "referrerCode" VARCHAR(32),
  "source" VARCHAR(20),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_referral_locks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_referral_locks_referredClientId_key" ON "affiliate_referral_locks"("referredClientId");
CREATE INDEX IF NOT EXISTS "affiliate_referral_locks_emailNormalized_idx" ON "affiliate_referral_locks"("emailNormalized");
CREATE INDEX IF NOT EXISTS "affiliate_referral_locks_fullNameNormalized_idx" ON "affiliate_referral_locks"("fullNameNormalized");
ALTER TABLE "affiliate_referral_locks" DROP CONSTRAINT IF EXISTS "affiliate_referral_locks_referrerClientId_fkey";
ALTER TABLE "affiliate_referral_locks" ADD CONSTRAINT "affiliate_referral_locks_referrerClientId_fkey" FOREIGN KEY ("referrerClientId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

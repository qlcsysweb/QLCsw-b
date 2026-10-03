-- QLC AFFILIATE PROGRAM (documento funcional, al pie de la letra). Migracion NO destructiva: solo agrega columnas, tabla e indices.
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "referralCodeUsed" VARCHAR(32);
ALTER TABLE "affiliate_configuration" ADD COLUMN IF NOT EXISTS "balanceStaleDays" INTEGER NOT NULL DEFAULT 31;
ALTER TABLE "affiliate_configuration_history" ADD COLUMN IF NOT EXISTS "balanceStaleDays" INTEGER;
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "affiliateConfigVersionId" TEXT;
ALTER TABLE "affiliate_commissions" ADD COLUMN IF NOT EXISTS "configVersionId" TEXT;
CREATE TABLE IF NOT EXISTS "statement_attachments" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveFolderId" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "statement_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "statement_attachments_statementId_idx" ON "statement_attachments"("statementId");
ALTER TABLE "statement_attachments" ADD CONSTRAINT "statement_attachments_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

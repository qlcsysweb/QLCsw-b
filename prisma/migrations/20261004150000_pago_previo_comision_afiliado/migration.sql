-- Pago previo de la comision del afiliador por estado de cuenta. Migracion NO destructiva.
ALTER TABLE "affiliate_payments" ADD COLUMN IF NOT EXISTS "apiSubaccountId" TEXT;
ALTER TABLE "affiliate_payments" ADD COLUMN IF NOT EXISTS "statementId" TEXT;
ALTER TABLE "affiliate_payments" ADD COLUMN IF NOT EXISTS "voidReason" VARCHAR(300);
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_payments_statementId_key" ON "affiliate_payments"("statementId");
CREATE INDEX IF NOT EXISTS "affiliate_payments_apiSubaccountId_idx" ON "affiliate_payments"("apiSubaccountId");
ALTER TABLE "affiliate_payments" ADD CONSTRAINT "affiliate_payments_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

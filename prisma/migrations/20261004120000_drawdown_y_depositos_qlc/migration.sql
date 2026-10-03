-- Maximum Drawdown editable por admin y depositos de QLC al cliente. Migracion NO destructiva.
ALTER TABLE "track_records" ADD COLUMN IF NOT EXISTS "maxDrawdown" DECIMAL(5,2);
CREATE TABLE IF NOT EXISTS "qlc_deposits" (
    "id" TEXT NOT NULL,
    "apiSubaccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "depositedAt" TIMESTAMP(3) NOT NULL,
    "reference" VARCHAR(200),
    "note" VARCHAR(500),
    "createdByUserId" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qlc_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qlc_deposits_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "qlc_deposits_apiSubaccountId_depositedAt_idx" ON "qlc_deposits"("apiSubaccountId", "depositedAt");
ALTER TABLE "qlc_deposits" ADD CONSTRAINT "qlc_deposits_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

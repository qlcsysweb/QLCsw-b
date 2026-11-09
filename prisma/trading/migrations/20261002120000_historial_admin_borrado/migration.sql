-- El admin puede borrar de los historiales de la subcuenta transferencias revisadas, estados de cuenta pagados y reportes de capital revisados (se ocultan, no se eliminan).
ALTER TABLE "payment_reports" ADD COLUMN IF NOT EXISTS "adminHiddenAt" TIMESTAMP(3);
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "adminHiddenAt" TIMESTAMP(3);
ALTER TABLE "capital_distribution_reports" ADD COLUMN IF NOT EXISTS "adminHiddenAt" TIMESTAMP(3);

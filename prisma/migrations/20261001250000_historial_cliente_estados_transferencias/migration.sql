-- El cliente puede borrar de su historial estados de cuenta pagados y transferencias revisadas (se ocultan, no se eliminan).
ALTER TABLE "statements" ADD COLUMN IF NOT EXISTS "clientHiddenAt" TIMESTAMP(3);
ALTER TABLE "payment_reports" ADD COLUMN IF NOT EXISTS "clientHiddenAt" TIMESTAMP(3);

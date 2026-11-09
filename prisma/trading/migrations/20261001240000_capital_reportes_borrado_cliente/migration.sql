-- El cliente puede borrar de su historial los reportes de capital ya revisados (se ocultan, no se eliminan).
ALTER TABLE "capital_distribution_reports" ADD COLUMN IF NOT EXISTS "clientHiddenAt" TIMESTAMP(3);

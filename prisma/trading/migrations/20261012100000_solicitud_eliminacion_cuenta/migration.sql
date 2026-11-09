-- Solicitud de eliminación de cuenta por el propio cliente (desactivación segura, sin borrado en cascada).
-- Solo agrega columnas opcionales: ninguna cuenta existente cambia.
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "accountDeletionStatus" VARCHAR(20);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "accountDeletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "accountDeactivatedAt" TIMESTAMP(3);
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "accountAnonymizedAt" TIMESTAMP(3);

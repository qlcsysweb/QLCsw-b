-- Bloque de 20 correcciones:
-- 1) Usuario del cliente — independiente de correo/nombre (CORRECCIÓN 2).
-- 2) IP requerida/valor por subcuenta/API — dato administrativo, sin
--    conexión real al exchange (CORRECCIÓN 6/18).
-- 3) "Transferencia recibida" separada de "Garantía reportada" (APROBADO)
--    en los reportes de pago (CORRECCIÓN 10).

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "client_profiles_username_key" ON "client_profiles"("username");

-- AlterTable
ALTER TABLE "api_subaccounts"
  ADD COLUMN "ipRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ipAddress" TEXT;

-- AlterTable
ALTER TABLE "payment_reports"
  ADD COLUMN "transferReceivedAt" TIMESTAMP(3),
  ADD COLUMN "transferReceivedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "payment_reports"
  ADD CONSTRAINT "payment_reports_transferReceivedByUserId_fkey"
  FOREIGN KEY ("transferReceivedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

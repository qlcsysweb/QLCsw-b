-- El contrato deja de ser un requisito del flujo operativo de QLC (se
-- sustituyó por la aceptación de Términos y Condiciones en el registro).
-- Se elimina la funcionalidad de contrato por completo: la tabla
-- "contracts", el tipo "CONTRACT" de ProcessConditionType (condición de
-- activación por subcuenta) y las columnas/relaciones asociadas.

-- 1) Quitar la condición CONTRACT de procesos existentes (ya no debe
--    bloquear la activación de ninguna subcuenta).
DELETE FROM "process_conditions" WHERE "type" = 'CONTRACT';

-- 2) Recrear ProcessConditionType sin el valor CONTRACT (Postgres no
--    permite eliminar un valor de enum directamente).
ALTER TYPE "ProcessConditionType" RENAME TO "ProcessConditionType_old";
CREATE TYPE "ProcessConditionType" AS ENUM ('WALLET', 'FUNDS', 'PAYMENT', 'API', 'ACTIVATION');
ALTER TABLE "process_conditions"
  ALTER COLUMN "type" TYPE "ProcessConditionType" USING ("type"::text::"ProcessConditionType");
DROP TYPE "ProcessConditionType_old";

-- 3) Eliminar la tabla de contratos y su enum de estado.
DROP TABLE IF EXISTS "contracts";
DROP TYPE IF EXISTS "ContractStatus";

-- 4) Eliminar la carpeta de Drive cacheada para contratos.
ALTER TABLE "client_profiles" DROP COLUMN IF EXISTS "driveContractsFolderId";

-- 5) La cita ahora también debe asociarse a la cuenta/subcuenta a revisar.
ALTER TABLE "appointments" ADD COLUMN "apiSubaccountId" TEXT;
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_apiSubaccountId_fkey"
  FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- GESTIÓN DINÁMICA DE SUBCUENTAS/API
--
-- Reemplaza la lógica de "subcuentas ocultas" (20 subcuentas pre-creadas
-- por cliente, la mayoría nunca usadas) por un modelo de solicitud/
-- aprobación: cada cliente nace con únicamente su cuenta PRINCIPAL, y toda
-- subcuenta adicional requiere que el cliente la solicite y un admin la
-- apruebe. Lo mismo para eliminar una subcuenta que ya no usa.

-- 1) Nuevos campos de "eliminación lógica" en api_subaccounts. Nunca se usa
--    un DELETE real sobre esta tabla (arrastraría en cascada estados de
--    cuenta, pagos y documentos históricos) — solo se marca removedAt.
ALTER TABLE "api_subaccounts" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "api_subaccounts" ADD COLUMN "removedByUserId" TEXT;

-- 2) Migración de datos segura de las subcuentas "ocultas" existentes:
--    todas las que el cliente NUNCA pudo ver (visibleToClient=false,
--    no-principal) pasan a estar "removidas" — desde la perspectiva del
--    cliente no cambia nada (seguían sin verlas), y ahora queda reflejado
--    correctamente en el nuevo modelo en vez de con la columna eliminada.
--    No se borra ninguna fila ni ningún dato histórico.
UPDATE "api_subaccounts"
SET "removedAt" = NOW()
WHERE "isPrincipal" = false AND "visibleToClient" = false;

-- 3) Ya no existe el concepto de "oculta para el cliente" — toda subcuenta
--    que exista y no esté removedAt es, por definición, visible/activa.
ALTER TABLE "api_subaccounts" DROP COLUMN "visibleToClient";

ALTER TABLE "api_subaccounts"
  ADD CONSTRAINT "api_subaccounts_removedByUserId_fkey"
  FOREIGN KEY ("removedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Solicitudes de creación/eliminación de subcuenta.
CREATE TYPE "SubaccountRequestType" AS ENUM ('CREATE', 'DELETE');
CREATE TYPE "SubaccountRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "subaccount_requests" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "SubaccountRequestType" NOT NULL,
    "apiSubaccountId" TEXT,
    "reason" TEXT,
    "status" "SubaccountRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "subaccount_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subaccount_requests_clientId_idx" ON "subaccount_requests"("clientId");
CREATE INDEX "subaccount_requests_apiSubaccountId_idx" ON "subaccount_requests"("apiSubaccountId");
CREATE INDEX "subaccount_requests_status_idx" ON "subaccount_requests"("status");

ALTER TABLE "subaccount_requests" ADD CONSTRAINT "subaccount_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subaccount_requests" ADD CONSTRAINT "subaccount_requests_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subaccount_requests" ADD CONSTRAINT "subaccount_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subaccount_requests" ADD CONSTRAINT "subaccount_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) Migra cualquier solicitud YA pendiente (subaccountRequestedAt) hacia
--    una fila real en subaccount_requests, ANTES de eliminar esa columna,
--    para no perder solicitudes de clientes que ya estaban esperando
--    revisión del admin.
INSERT INTO "subaccount_requests" ("id", "clientId", "type", "reason", "status", "requestedByUserId", "requestedAt")
SELECT
    'migrated_' || cp."id",
    cp."id",
    'CREATE',
    'Solicitud migrada automáticamente desde el sistema anterior de subcuentas ocultas.',
    'PENDING',
    cp."userId",
    cp."subaccountRequestedAt"
FROM "client_profiles" cp
WHERE cp."subaccountRequestedAt" IS NOT NULL;

-- 6) La marca única "el cliente pidió una subcuenta" queda reemplazada por
--    la tabla subaccount_requests (soporta historial completo, motivo, y
--    tanto solicitudes de creación como de eliminación).
ALTER TABLE "client_profiles" DROP COLUMN "subaccountRequestedAt";

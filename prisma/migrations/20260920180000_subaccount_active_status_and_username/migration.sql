-- CORRECCIÓN DEFINITIVA DE SUBCUENTAS, CLIENTES Y NOMENCLATURA
--
-- 1) Subcuentas por ESTADO (ACTIVA/INACTIVA), no por eliminación: se
--    renombran las columnas "removedAt"/"removedByUserId" a
--    "deactivatedAt"/"deactivatedByUserId" — NINGÚN dato cambia ni se
--    pierde, solo el nombre para que el código y la interfaz dejen de
--    hablar de "eliminar" y pasen a hablar de "activar/desactivar"
--    (reversible). La fila y su historial (estados de cuenta, pagos,
--    documentos) nunca se tocan.
ALTER TABLE "api_subaccounts" RENAME COLUMN "removedAt" TO "deactivatedAt";
ALTER TABLE "api_subaccounts" RENAME COLUMN "removedByUserId" TO "deactivatedByUserId";

-- 2) La solicitud de "eliminar" una subcuenta pasa a ser una solicitud de
--    "desactivar" — mismo registro, mismo historial, nuevo nombre.
ALTER TYPE "SubaccountRequestType" RENAME VALUE 'DELETE' TO 'DEACTIVATE';

-- 3) Nomenclatura única del cliente: máximo 30 caracteres, reforzado también
--    a nivel de columna (ya se valida en la aplicación). Ningún valor
--    existente supera ese largo, así que la conversión es segura.
ALTER TABLE "client_profiles" ALTER COLUMN "username" TYPE VARCHAR(30);

-- Ocultar por defecto las subcuentas numeradas (1..20) que el cliente aun
-- no usa: solo la PRINCIPAL y las ya CONECTADA quedan visibles de entrada.
ALTER TABLE "api_subaccounts" ADD COLUMN "visibleToClient" BOOLEAN NOT NULL DEFAULT false;

UPDATE "api_subaccounts"
SET "visibleToClient" = true
WHERE "isPrincipal" = true OR "status" = 'CONECTADA';

-- Marca de "el cliente pidio una subcuenta adicional", pendiente de que un
-- admin revele una de las ocultas.
ALTER TABLE "client_profiles" ADD COLUMN "subaccountRequestedAt" TIMESTAMP(3);

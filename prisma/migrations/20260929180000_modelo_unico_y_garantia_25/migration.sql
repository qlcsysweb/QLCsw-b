-- MODELO ÚNICO DE PARTICIPACIÓN (70% QLC / 30% Cliente) + GARANTÍA 25% SOBRE CAPITAL.
-- Respaldo previo de lo eliminado/modificado: prisma/backups/20260929_modelo_unico_backup.json
-- (Nota: este archivo se aplica sentencia por sentencia separando por punto y coma,
-- por eso ningún texto de abajo contiene ese carácter.)

-- 1) Las asignaciones a otros modelos se normalizan al modelo 70/30 (se conserva la fila y sus fechas).
UPDATE "client_models"
SET "modelId" = (SELECT "id" FROM "models" WHERE "key" = 'PERFORMANCE')
WHERE "modelId" <> (SELECT "id" FROM "models" WHERE "key" = 'PERFORMANCE');

-- 2) Toda subcuenta sin modelo recibe el modelo único (ya no existe selector).
INSERT INTO "client_models" ("id", "apiSubaccountId", "modelId", "selectedAt", "confirmedAt")
SELECT gen_random_uuid()::text, s."id", (SELECT "id" FROM "models" WHERE "key" = 'PERFORMANCE'), NOW(), NOW()
FROM "api_subaccounts" s
WHERE NOT EXISTS (SELECT 1 FROM "client_models" cm WHERE cm."apiSubaccountId" = s."id");

-- 3) Sin paso de confirmación: el modelo único queda confirmado.
UPDATE "client_models" SET "confirmedAt" = NOW() WHERE "confirmedAt" IS NULL;

-- 4) Se eliminan los demás modelos (ya sin asignaciones).
DELETE FROM "models" WHERE "key" <> 'PERFORMANCE';

-- 5) El modelo que queda se presenta como "Modelo de participación".
UPDATE "models"
SET "name" = 'Modelo de participación',
    "nameEn" = 'Participation model',
    "conditions" = 'QLC: 70% · Cliente: 30%',
    "conditionsEn" = 'QLC: 70% · Client: 30%',
    "percentage" = '70/30',
    "objective" = NULL,
    "period" = NULL,
    "periodEn" = NULL,
    "isActive" = true,
    "displayOrder" = 1,
    "description" = REPLACE("description", 'El modelo Performance', 'El modelo de participación'),
    "descriptionEn" = REPLACE("descriptionEn", 'The Performance model', 'The participation model')
WHERE "key" = 'PERFORMANCE';

-- 6) "Tu proceso, paso a paso": ya no se elige modelo y la garantía es 25% sobre capital.
UPDATE "process_steps"
SET "titleEs" = 'Conocer el modelo de participación',
    "titleEn" = 'Review the participation model',
    "descriptionEs" = 'Tu subcuenta opera con el modelo de participación: QLC 70% · Cliente 30%.',
    "descriptionEn" = 'Your subaccount operates with the participation model: QLC 70% · Client 30%.'
WHERE "titleEs" = 'Seleccionar el modelo de participación';

UPDATE "process_steps"
SET "descriptionEs" = 'Desde Pagos, realiza el depósito en garantía: 25% sobre capital.',
    "descriptionEn" = 'From Payments, make the guarantee deposit: 25% on capital.'
WHERE "titleEs" = 'Realizar el depósito en garantía';

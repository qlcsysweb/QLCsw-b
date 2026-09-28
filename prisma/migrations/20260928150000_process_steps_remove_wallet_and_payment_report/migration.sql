-- "Tu proceso, paso a paso": se retiran del cliente los pasos
-- "Cargar tu Wallet" y "Reportar el pago a QLC" (pedido de QLC).
-- NO se borran: quedan INACTIVOS (el admin puede reactivarlos desde
-- Configuración · Proceso paso a paso) y se envían al final del orden.
UPDATE "process_steps"
SET "isActive" = false,
    "displayOrder" = 1000 + "displayOrder"
WHERE "isActive" = true
  AND ("titleEs" ILIKE '%wallet%' OR "titleEs" = 'Reportar el pago a QLC');

-- Los pasos activos se renumeran para quedar consecutivos (1, 2, 3...).
UPDATE "process_steps" ps
SET "stepNumber" = r.rn,
    "displayOrder" = r.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "displayOrder", "stepNumber") AS rn
  FROM "process_steps"
  WHERE "isActive" = true
) r
WHERE ps."id" = r."id";

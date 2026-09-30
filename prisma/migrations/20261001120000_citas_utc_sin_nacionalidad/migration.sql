-- Citas en UTC: marca de zona horaria por fila (aditivo, compatible con el
-- código anterior). Las filas existentes quedan en NULL (hora de México) y el
-- backend nuevo las convierte a UTC una sola vez al arrancar.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "timeZone" TEXT;
ALTER TABLE "availability_slots" ADD COLUMN IF NOT EXISTS "timeZone" TEXT;

-- Guías: se retira la mención a la nacionalidad (ya no se solicita).
UPDATE "guides" SET "contentEs" = replace("contentEs", 'nombre completo, nacionalidad y documentación correspondiente', 'nombre completo y documentación correspondiente') WHERE "contentEs" LIKE '%nacionalidad%';
UPDATE "guides" SET "contentEs" = replace("contentEs", 'Su información del cliente (nombre, nacionalidad) se registra', 'Su información del cliente (nombre) se registra') WHERE "contentEs" LIKE '%nacionalidad%';
UPDATE "guides" SET "contentEn" = replace("contentEn", 'full name, nationality and required documentation', 'full name and required documentation') WHERE "contentEn" LIKE '%nationality%';
UPDATE "guides" SET "contentEn" = replace("contentEn", 'Your client information (name, nationality) is registered', 'Your client information (name) is registered') WHERE "contentEn" LIKE '%nationality%';

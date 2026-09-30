-- El cliente puede borrar una cita de su lista (QLC la conserva).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "clientHiddenAt" TIMESTAMP(3);

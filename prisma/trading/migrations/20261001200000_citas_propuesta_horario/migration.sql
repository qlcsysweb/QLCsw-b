-- Reagendar: el admin propone otro horario (UTC) al rechazar una cita.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "proposedDate" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "proposedTime" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "proposalStatus" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "proposedAt" TIMESTAMP(3);

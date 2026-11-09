-- ESTADO DE CUENTA SIMPLIFICADO + TRANSFERENCIA INTERNA BITGET (versión SEGURA / ADITIVA).
-- Solo agrega columnas/tipos y relaja una restricción; NO elimina tablas, columnas ni filas.
-- Lo destructivo de la migración original (drops de wallet, tablas de capital, columnas legacy
-- de statements, condición WALLET, pasos del proceso, guía) quedó documentado y SIN ejecutar en
-- prisma/pending_destructive_cleanup.original_20260924.sql.

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('PENDIENTE_DE_PAGO', 'PAGADO', 'VENCIDO_SIN_PAGAR');

-- Configuración de pago: UID de recepción Bitget
ALTER TABLE "payment_configuration" ADD COLUMN "bitgetReceiveUid" TEXT;

-- Reporte de transferencia interna Bitget (amount pasa a opcional: no borra datos)
ALTER TABLE "payment_reports" ADD COLUMN "bitgetOrderNumber" TEXT,
ADD COLUMN "transactionAt" TIMESTAMP(3);
ALTER TABLE "payment_reports" ALTER COLUMN "amount" DROP NOT NULL;

-- Estados de cuenta: nuevas columnas + backfill de los existentes desde las columnas legacy
-- (que se CONSERVAN intactas).
ALTER TABLE "statements" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "status" "StatementStatus" NOT NULL DEFAULT 'PENDIENTE_DE_PAGO',
ADD COLUMN "warningSentAt" TIMESTAMP(3);

UPDATE "statements" SET
  "generatedAt"   = "createdAt",
  "expiresAt"     = COALESCE("commissionDueAt", "createdAt" + INTERVAL '72 hours'),
  "paidAt"        = CASE WHEN "commissionPaid" THEN COALESCE("commissionPaidAt", "createdAt") ELSE NULL END,
  "warningSentAt" = "commissionWarningSentAt",
  "status" = CASE
    WHEN "commissionPaid" THEN 'PAGADO'::"StatementStatus"
    WHEN COALESCE("commissionDueAt", "createdAt" + INTERVAL '72 hours') <= NOW() THEN 'VENCIDO_SIN_PAGAR'::"StatementStatus"
    ELSE 'PENDIENTE_DE_PAGO'::"StatementStatus"
  END;

ALTER TABLE "statements" ALTER COLUMN "expiresAt" SET NOT NULL;

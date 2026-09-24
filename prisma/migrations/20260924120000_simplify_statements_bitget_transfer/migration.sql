-- SIMPLIFICACIÓN DEL ESTADO DE CUENTA + TRANSFERENCIA INTERNA BITGET
-- Elimina: invitaciones de aumento de saldo, capital temporal para rescate,
-- wallet personal del cliente y la condición WALLET del proceso.
-- Estado de cuenta: estado persistido (PENDIENTE_DE_PAGO / PAGADO /
-- VENCIDO_SIN_PAGAR) + expiresAt calculado en backend.

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('PENDIENTE_DE_PAGO', 'PAGADO', 'VENCIDO_SIN_PAGAR');

-- Condición WALLET del proceso: se elimina antes de cambiar el enum.
DELETE FROM "process_conditions" WHERE "type" = 'WALLET';

-- AlterEnum
BEGIN;
CREATE TYPE "ProcessConditionType_new" AS ENUM ('FUNDS', 'PAYMENT', 'API', 'ACTIVATION');
ALTER TABLE "process_conditions" ALTER COLUMN "type" TYPE "ProcessConditionType_new" USING ("type"::text::"ProcessConditionType_new");
ALTER TYPE "ProcessConditionType" RENAME TO "ProcessConditionType_old";
ALTER TYPE "ProcessConditionType_new" RENAME TO "ProcessConditionType";
DROP TYPE "ProcessConditionType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "capital_increase_invitations" DROP CONSTRAINT "capital_increase_invitations_clientId_fkey";
ALTER TABLE "capital_increase_invitations" DROP CONSTRAINT "capital_increase_invitations_createdByUserId_fkey";
ALTER TABLE "capital_increase_requests" DROP CONSTRAINT "capital_increase_requests_invitationId_fkey";
ALTER TABLE "capital_distributions" DROP CONSTRAINT "capital_distributions_requestId_fkey";
ALTER TABLE "capital_distribution_items" DROP CONSTRAINT "capital_distribution_items_distributionId_fkey";
ALTER TABLE "capital_distribution_items" DROP CONSTRAINT "capital_distribution_items_apiSubaccountId_fkey";
ALTER TABLE "capital_rescue_invitations" DROP CONSTRAINT "capital_rescue_invitations_clientId_fkey";
ALTER TABLE "capital_rescue_invitations" DROP CONSTRAINT "capital_rescue_invitations_apiSubaccountId_fkey";
ALTER TABLE "capital_rescue_invitations" DROP CONSTRAINT "capital_rescue_invitations_createdByUserId_fkey";
ALTER TABLE "capital_rescue_participations" DROP CONSTRAINT "capital_rescue_participations_invitationId_fkey";
ALTER TABLE "capital_rescue_distributions" DROP CONSTRAINT "capital_rescue_distributions_participationId_fkey";
ALTER TABLE "capital_rescue_distribution_items" DROP CONSTRAINT "capital_rescue_distribution_items_distributionId_fkey";
ALTER TABLE "capital_rescue_distribution_items" DROP CONSTRAINT "capital_rescue_distribution_items_apiSubaccountId_fkey";

-- Evidencias de estado de cuenta: el documento se CONSERVA (sigue en Drive
-- y en el listado de documentos del cliente), solo se desvincula.
ALTER TABLE "documents" DROP CONSTRAINT "documents_statementId_fkey";
ALTER TABLE "documents" DROP COLUMN "statementId";

-- Wallet personal del cliente (y su carpeta "QR" en Drive, usada solo por el QR de wallet)
ALTER TABLE "client_profiles" DROP COLUMN "driveQrFolderId",
DROP COLUMN "walletAddress",
DROP COLUMN "walletNetwork",
DROP COLUMN "walletQrDriveFileId",
DROP COLUMN "walletQrDriveFolderId",
DROP COLUMN "walletQrPublicId",
DROP COLUMN "walletQrUrl";

-- Configuración de pago: wallet/red/QR → UID de recepción Bitget
ALTER TABLE "payment_configuration" DROP COLUMN "network",
DROP COLUMN "paymentLink",
DROP COLUMN "qrDriveFileId",
DROP COLUMN "qrDriveFolderId",
DROP COLUMN "qrPublicId",
DROP COLUMN "qrUrl",
DROP COLUMN "walletAddress",
ADD COLUMN     "bitgetReceiveUid" TEXT;

-- Reporte de transferencia interna Bitget
ALTER TABLE "payment_reports" ADD COLUMN     "bitgetOrderNumber" TEXT,
ADD COLUMN     "transactionAt" TIMESTAMP(3),
ALTER COLUMN "amount" DROP NOT NULL;

-- Estados de cuenta: nuevas columnas + migración segura de los existentes.
ALTER TABLE "statements" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN     "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "status" "StatementStatus" NOT NULL DEFAULT 'PENDIENTE_DE_PAGO',
ADD COLUMN     "warningSentAt" TIMESTAMP(3);

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
ALTER TABLE "statements" DROP COLUMN "archived",
DROP COLUMN "archivedAt",
DROP COLUMN "commissionDueAt",
DROP COLUMN "commissionPaid",
DROP COLUMN "commissionPaidAt",
DROP COLUMN "commissionWarningSentAt";

-- DropTable
DROP TABLE "capital_increase_invitations";
DROP TABLE "capital_increase_requests";
DROP TABLE "capital_distributions";
DROP TABLE "capital_distribution_items";
DROP TABLE "capital_rescue_invitations";
DROP TABLE "capital_rescue_participations";
DROP TABLE "capital_rescue_distributions";
DROP TABLE "capital_rescue_distribution_items";

-- DropEnum
DROP TYPE "CapitalInvitationStatus";
DROP TYPE "CapitalRequestStatus";
DROP TYPE "RescueInvitationStatus";
DROP TYPE "RescueParticipationStatus";

-- "Tu proceso paso a paso": se elimina el paso de Wallet y se renumera
-- para que queden 8 pasos consecutivos.
DELETE FROM "process_steps" WHERE "titleEs" ILIKE '%wallet%';
UPDATE "process_steps" ps SET "stepNumber" = r.rn, "displayOrder" = r.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "displayOrder", "stepNumber") AS rn
  FROM "process_steps"
) r
WHERE ps."id" = r."id";

-- Textos de los pasos de depósito/reporte alineados a la transferencia
-- interna Bitget (solo si conservan el texto original).
UPDATE "process_steps" SET
  "descriptionEs" = 'Desde Pagos / Garantía, envía tu depósito en garantía (mínimo 10% del monto de inversión) mediante Transferencia interna Bitget al UID de recepción de QLC.',
  "descriptionEn" = 'From Payments / Guarantee, send your guarantee deposit (minimum 10% of the invested amount) via Bitget internal transfer to QLC''s receiving UID.'
WHERE "titleEs" = 'Realizar el depósito en garantía';
UPDATE "process_steps" SET
  "descriptionEs" = 'Reporta tu transferencia indicando únicamente el número de orden y la fecha y hora de la transacción, para que el equipo de QLC la revise.',
  "descriptionEn" = 'Report your transfer providing only the order number and the transaction date and time, so the QLC team can review it.'
WHERE "titleEs" = 'Reportar el pago a QLC';

-- Guía de "Invitaciones Especiales": la función ya no existe.
DELETE FROM "guides" WHERE "titleEs" = 'Flujo de Invitaciones Especiales';

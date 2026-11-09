-- DATOS DE PAGO POR SUBCUENTA + ARCHIVOS Y LECTURA DE MENSAJES DE CASOS (aditiva)
-- AlterTable
ALTER TABLE "support_case_messages" ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "support_case_files" (
    "id" TEXT NOT NULL,
    "supportCaseId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveFolderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_case_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subaccount_payment_data" (
    "id" TEXT NOT NULL,
    "apiSubaccountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "bitgetReceiveUid" TEXT,
    "instructions" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subaccount_payment_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subaccount_payment_data_apiSubaccountId_key" ON "subaccount_payment_data"("apiSubaccountId");

-- CreateIndex
CREATE INDEX "support_case_messages_supportCaseId_readAt_idx" ON "support_case_messages"("supportCaseId", "readAt");

-- AddForeignKey
ALTER TABLE "support_case_files" ADD CONSTRAINT "support_case_files_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "support_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case_files" ADD CONSTRAINT "support_case_files_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subaccount_payment_data" ADD CONSTRAINT "subaccount_payment_data_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subaccount_payment_data" ADD CONSTRAINT "subaccount_payment_data_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill (sin pérdida de datos): los mensajes existentes se consideran leídos
-- (no deben aparecer como "nuevos"), y cada subcuenta hereda el UID de
-- recepción hoy configurado de forma global para que nada quede sin datos de
-- pago; a partir de ahora cada subcuenta administra el suyo.
UPDATE "support_case_messages" SET "readAt" = "createdAt" WHERE "readAt" IS NULL;

INSERT INTO "subaccount_payment_data" ("id", "apiSubaccountId", "currency", "bitgetReceiveUid", "instructions", "updatedAt")
SELECT 'spd_' || s."id", s."id", 'USDT', c."bitgetReceiveUid", c."instructions", NOW()
FROM "api_subaccounts" s
CROSS JOIN (SELECT "bitgetReceiveUid", "instructions" FROM "payment_configuration" ORDER BY "updatedAt" DESC LIMIT 1) c
WHERE c."bitgetReceiveUid" IS NOT NULL;

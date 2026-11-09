-- CreateEnum
CREATE TYPE "ConnectionEventType" AS ENUM ('DISCONNECTED', 'RECONNECTED');

-- CreateTable
CREATE TABLE "api_subaccounts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "identifier" TEXT,
    "exchangeName" TEXT NOT NULL DEFAULT 'Bitget',
    "apiKeyEncrypted" TEXT,
    "apiSecretEncrypted" TEXT,
    "apiPassphraseEncrypted" TEXT,
    "status" "ApiConnectionStatus" NOT NULL DEFAULT 'PENDIENTE',
    "requiredCapital" DECIMAL(12,2),
    "clientReportedCapitalReady" BOOLEAN NOT NULL DEFAULT false,
    "clientReportedCapitalAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "reconnectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_subaccounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_connection_events" (
    "id" TEXT NOT NULL,
    "apiSubaccountId" TEXT NOT NULL,
    "eventType" "ConnectionEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_connection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statements" (
    "id" TEXT NOT NULL,
    "apiSubaccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "startingBalance" DECIMAL(14,2) NOT NULL,
    "endingBalance" DECIMAL(14,2) NOT NULL,
    "resultAmount" DECIMAL(14,2) NOT NULL,
    "resultPercentage" DECIMAL(7,2) NOT NULL,
    "commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "activityNotes" TEXT,
    "adminNotes" TEXT,
    "pdfDriveFileId" TEXT,
    "pdfDriveFolderId" TEXT,
    "pdfFileName" TEXT,
    "commissionDueAt" TIMESTAMP(3),
    "commissionPaid" BOOLEAN NOT NULL DEFAULT false,
    "commissionPaidAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- Add new FK columns as NULLABLE first (data migration happens before NOT NULL enforcement)
ALTER TABLE "client_models" ADD COLUMN "apiSubaccountId" TEXT;
ALTER TABLE "processes" ADD COLUMN "apiSubaccountId" TEXT;
ALTER TABLE "contracts" ADD COLUMN "apiSubaccountId" TEXT;
ALTER TABLE "contracts" ADD COLUMN "generatedAt" TIMESTAMP(3);
ALTER TABLE "payment_reports" ADD COLUMN "apiSubaccountId" TEXT;
ALTER TABLE "payment_reports" ADD COLUMN "statementId" TEXT;

-- Data migration: one api_subaccount (slot 1) per existing api_connections row
INSERT INTO "api_subaccounts" ("id","clientId","slotIndex","exchangeName","apiKeyEncrypted","apiSecretEncrypted","status","notes","updatedByUserId","updatedAt","createdAt")
SELECT gen_random_uuid()::text, "clientId", 1, "exchangeName", "apiKeyEncrypted", "apiSecretEncrypted", "status", "notes", "updatedByUserId", "updatedAt", "createdAt"
FROM "api_connections";

-- Defensive fallback: cover any client_profile with related rows but no api_connections row
INSERT INTO "api_subaccounts" ("id","clientId","slotIndex","exchangeName","status","updatedAt","createdAt")
SELECT gen_random_uuid()::text, cp."id", 1, 'Bitget', 'PENDIENTE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "client_profiles" cp
WHERE cp."id" NOT IN (SELECT "clientId" FROM "api_subaccounts")
AND (
  EXISTS (SELECT 1 FROM "contracts" c WHERE c."clientId" = cp."id")
  OR EXISTS (SELECT 1 FROM "processes" p WHERE p."clientId" = cp."id")
  OR EXISTS (SELECT 1 FROM "payment_reports" pr WHERE pr."clientId" = cp."id")
  OR EXISTS (SELECT 1 FROM "client_models" cm WHERE cm."clientId" = cp."id")
);

-- Point existing rows at the new subaccount (slot 1 of their client)
UPDATE "client_models" cm SET "apiSubaccountId" = asub."id" FROM "api_subaccounts" asub WHERE asub."clientId" = cm."clientId" AND asub."slotIndex" = 1;
UPDATE "processes" p SET "apiSubaccountId" = asub."id" FROM "api_subaccounts" asub WHERE asub."clientId" = p."clientId" AND asub."slotIndex" = 1;
UPDATE "contracts" c SET "apiSubaccountId" = asub."id" FROM "api_subaccounts" asub WHERE asub."clientId" = c."clientId" AND asub."slotIndex" = 1;
UPDATE "payment_reports" pr SET "apiSubaccountId" = asub."id" FROM "api_subaccounts" asub WHERE asub."clientId" = pr."clientId" AND asub."slotIndex" = 1;

-- Drop old FKs / unique indexes tied to clientId
ALTER TABLE "client_models" DROP CONSTRAINT "client_models_clientId_fkey";
ALTER TABLE "processes" DROP CONSTRAINT "processes_clientId_fkey";
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_clientId_fkey";
ALTER TABLE "payment_reports" DROP CONSTRAINT "payment_reports_clientId_fkey";
DROP INDEX "client_models_clientId_key";
DROP INDEX "processes_clientId_key";

-- Drop the old clientId columns now that apiSubaccountId is populated
ALTER TABLE "client_models" DROP COLUMN "clientId";
ALTER TABLE "processes" DROP COLUMN "clientId";
ALTER TABLE "contracts" DROP COLUMN "clientId";
ALTER TABLE "payment_reports" DROP COLUMN "clientId";

-- Enforce NOT NULL now that every row has a value
ALTER TABLE "client_models" ALTER COLUMN "apiSubaccountId" SET NOT NULL;
ALTER TABLE "processes" ALTER COLUMN "apiSubaccountId" SET NOT NULL;
ALTER TABLE "contracts" ALTER COLUMN "apiSubaccountId" SET NOT NULL;
ALTER TABLE "payment_reports" ALTER COLUMN "apiSubaccountId" SET NOT NULL;

-- Retire the old 1-1 api_connections table (fully replaced by api_subaccounts)
DROP TABLE "api_connections";

-- models.key: fixed enum -> free-form unique text (CORRECCIÓN 30)
ALTER TABLE "models" ALTER COLUMN "key" TYPE TEXT USING "key"::TEXT;
DROP TYPE "ModelKey";
ALTER TABLE "models" ADD COLUMN "detailsContent" TEXT;
ALTER TABLE "models" ADD COLUMN "detailsContentEn" TEXT;

-- users: no more global username (CORRECCIÓN 17/18); prep for 2FA (CORRECCIÓN 19, inactive)
DROP INDEX "users_username_key";
ALTER TABLE "users" DROP COLUMN "username";
ALTER TABLE "users" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "twoFactorSecretEncrypted" TEXT;
ALTER TABLE "users" ADD COLUMN "twoFactorPendingSecretEncrypted" TEXT;

-- client_profiles: no more phone (CORRECCIÓN 6); wallet fields (CORRECCIÓN 28)
ALTER TABLE "client_profiles" DROP COLUMN "phone";
ALTER TABLE "client_profiles" ADD COLUMN "walletAddress" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "walletNetwork" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "walletQrUrl" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "walletQrPublicId" TEXT;

-- prospects: no more phone (CORRECCIÓN 6)
ALTER TABLE "prospects" DROP COLUMN "phone";

-- documents: admin-gated unlock (REVERSIÓN A)
ALTER TABLE "documents" ADD COLUMN "clientEditUnlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documents" ADD COLUMN "unlockedByUserId" TEXT;
ALTER TABLE "documents" ADD COLUMN "unlockedAt" TIMESTAMP(3);

-- drive_configuration: lock to configuring admin (CORRECCIÓN 24)
ALTER TABLE "drive_configuration" ADD COLUMN "configuredByUserId" TEXT;

-- platform_settings: remove "PDF informativo" (CORRECCIÓN 4 / REVERSIÓN B); add the two guide PDFs (CORRECCIÓN 27)
ALTER TABLE "platform_settings" DROP COLUMN "infoPdfDriveFileId";
ALTER TABLE "platform_settings" DROP COLUMN "infoPdfDriveFolderId";
ALTER TABLE "platform_settings" DROP COLUMN "infoPdfFileName";
ALTER TABLE "platform_settings" DROP COLUMN "infoPdfMimeType";
ALTER TABLE "platform_settings" DROP COLUMN "infoPdfSizeBytes";
ALTER TABLE "platform_settings" ADD COLUMN "adminGuidePdfUrl" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "adminGuidePdfPublicId" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "adminGuideFileName" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "clientGuidePdfUrl" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "clientGuidePdfPublicId" TEXT;
ALTER TABLE "platform_settings" ADD COLUMN "clientGuideFileName" TEXT;

-- CreateIndex (new unique constraints)
CREATE UNIQUE INDEX "api_subaccounts_identifier_key" ON "api_subaccounts"("identifier");
CREATE UNIQUE INDEX "api_subaccounts_clientId_slotIndex_key" ON "api_subaccounts"("clientId", "slotIndex");
CREATE UNIQUE INDEX "client_models_apiSubaccountId_key" ON "client_models"("apiSubaccountId");
CREATE UNIQUE INDEX "processes_apiSubaccountId_key" ON "processes"("apiSubaccountId");
CREATE UNIQUE INDEX "contracts_apiSubaccountId_key" ON "contracts"("apiSubaccountId");

-- AddForeignKey
ALTER TABLE "api_subaccounts" ADD CONSTRAINT "api_subaccounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_subaccounts" ADD CONSTRAINT "api_subaccounts_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "api_connection_events" ADD CONSTRAINT "api_connection_events_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_models" ADD CONSTRAINT "client_models_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "processes" ADD CONSTRAINT "processes_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_unlockedByUserId_fkey" FOREIGN KEY ("unlockedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drive_configuration" ADD CONSTRAINT "drive_configuration_configuredByUserId_fkey" FOREIGN KEY ("configuredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "statements" ADD CONSTRAINT "statements_apiSubaccountId_fkey" FOREIGN KEY ("apiSubaccountId") REFERENCES "api_subaccounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "statements" ADD CONSTRAINT "statements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- users: no more global username (CORRECCION 17/18)
-- also prep for 2FA (CORRECCION 19, inactive)
DROP INDEX "users_username_key";
ALTER TABLE "users" DROP COLUMN "username";
ALTER TABLE "users" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "twoFactorSecretEncrypted" TEXT;
ALTER TABLE "users" ADD COLUMN "twoFactorPendingSecretEncrypted" TEXT;

-- client_profiles: no more phone (CORRECCION 6)
-- also wallet fields (CORRECCION 28)
ALTER TABLE "client_profiles" DROP COLUMN "phone";
ALTER TABLE "client_profiles" ADD COLUMN "walletAddress" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "walletNetwork" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "walletQrUrl" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "walletQrPublicId" TEXT;

-- prospects: no more phone (CORRECCION 6)
ALTER TABLE "prospects" DROP COLUMN "phone";

-- documents: admin-gated unlock (REVERSION A)
ALTER TABLE "documents" ADD COLUMN "clientEditUnlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documents" ADD COLUMN "unlockedByUserId" TEXT;
ALTER TABLE "documents" ADD COLUMN "unlockedAt" TIMESTAMP(3);

-- drive_configuration: lock to configuring admin (CORRECCION 24)
ALTER TABLE "drive_configuration" ADD COLUMN "configuredByUserId" TEXT;

-- platform_settings: remove informative PDF (CORRECCION 4 / REVERSION B)
-- also add the two guide PDFs (CORRECCION 27)
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

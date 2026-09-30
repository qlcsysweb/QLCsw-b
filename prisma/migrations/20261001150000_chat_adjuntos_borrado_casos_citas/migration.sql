-- Chat de citas: archivo adjunto por mensaje (metadata, el binario en Drive).
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "driveFileId" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT;

-- El cliente puede borrar un caso de su vista (QLC lo conserva).
ALTER TABLE "support_cases" ADD COLUMN IF NOT EXISTS "clientHiddenAt" TIMESTAMP(3);

-- El admin puede borrar una cita de su lista (se conserva archivada).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "adminArchivedAt" TIMESTAMP(3);

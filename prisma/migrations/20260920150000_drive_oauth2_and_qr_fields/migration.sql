-- IMPLEMENTACIÓN DEFINITIVA DE GOOGLE DRIVE (cuenta personal, OAuth2)
--
-- 1) DriveConfiguration pasa de "cuenta de servicio" a OAuth2, igual patrón
--    que EmailConfiguration. Ninguna fila de producción tenía credenciales
--    de cuenta de servicio configuradas todavía (nunca se conectó), así que
--    no hay datos reales que perder al quitar esas dos columnas.
ALTER TABLE "drive_configuration" ADD COLUMN "googleOAuthClientId" TEXT;
ALTER TABLE "drive_configuration" ADD COLUMN "googleOAuthClientSecretEncrypted" TEXT;
ALTER TABLE "drive_configuration" ADD COLUMN "googleOAuthRefreshTokenEncrypted" TEXT;
ALTER TABLE "drive_configuration" ADD COLUMN "oauthConnectedEmail" TEXT;
ALTER TABLE "drive_configuration" DROP COLUMN "serviceAccountEmail";
ALTER TABLE "drive_configuration" DROP COLUMN "serviceAccountPrivateKeyEncrypted";

-- 2) Nuevas subcarpetas cacheadas por cliente (QR, Estados de cuenta) y
--    estado de sincronización de su carpeta en Drive.
ALTER TABLE "client_profiles" ADD COLUMN "driveStatementsFolderId" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "driveQrFolderId" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "driveSyncStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "client_profiles" ADD COLUMN "driveSyncError" TEXT;

-- Clientes ya existentes: si ya tienen su carpeta de Drive cacheada (aunque
-- sea de la implementación anterior), se marcan como SYNCED — evita que
-- todos los clientes existentes aparezcan como "pendiente de sincronizar"
-- cuando en realidad ya tienen carpeta.
UPDATE "client_profiles" SET "driveSyncStatus" = 'SYNCED' WHERE "driveClientFolderId" IS NOT NULL;

-- 3) Campos Drive para el QR de wallet del cliente y el QR de pagos global
--    — hoy viven en Cloudinary (qrUrl/qrPublicId, walletQrUrl/walletQrPublicId,
--    que se CONSERVAN sin tocar). Un QR subido de aquí en adelante usa Drive.
ALTER TABLE "client_profiles" ADD COLUMN "walletQrDriveFileId" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN "walletQrDriveFolderId" TEXT;
ALTER TABLE "payment_configuration" ADD COLUMN "qrDriveFileId" TEXT;
ALTER TABLE "payment_configuration" ADD COLUMN "qrDriveFolderId" TEXT;

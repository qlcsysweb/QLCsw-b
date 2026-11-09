-- AlterTable
-- Gmail API vía OAuth2 como alternativa a SMTP (Render free tier bloquea los
-- puertos 25/465/587 salientes; Gmail API usa HTTPS/443, que nunca se
-- bloquea). "authMethod" decide cuál credencial usa el envío real.
ALTER TABLE "email_configuration" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'APP_PASSWORD';
ALTER TABLE "email_configuration" ADD COLUMN "googleOAuthClientId" TEXT;
ALTER TABLE "email_configuration" ADD COLUMN "googleOAuthClientSecretEncrypted" TEXT;
ALTER TABLE "email_configuration" ADD COLUMN "googleOAuthRefreshTokenEncrypted" TEXT;
ALTER TABLE "email_configuration" ADD COLUMN "oauthConnectedEmail" TEXT;

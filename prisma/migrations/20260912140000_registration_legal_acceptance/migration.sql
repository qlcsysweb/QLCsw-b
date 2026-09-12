-- El contrato ya no forma parte del registro: se sustituye por la
-- aceptación electrónica del Aviso de Privacidad y los Términos y
-- Condiciones. Se conserva versión + fecha/hora de cada aceptación.
ALTER TABLE "client_profiles" ADD COLUMN     "privacyNoticeAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "privacyNoticeVersion" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT,
ADD COLUMN     "apiAuthorizationAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "apiAuthorizationAcceptedAt" TIMESTAMP(3);

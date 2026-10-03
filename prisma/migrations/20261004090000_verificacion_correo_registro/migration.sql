-- Verificacion de correo con codigo en el registro publico. Migracion NO destructiva.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "email_verification_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" VARCHAR(20) NOT NULL DEFAULT 'REGISTER',
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "email_verification_codes_email_purpose_idx" ON "email_verification_codes"("email", "purpose");

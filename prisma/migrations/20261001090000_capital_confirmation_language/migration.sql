-- Idioma (ES o EN) de la declaración de capital operativo que escribió el cliente.
ALTER TABLE "capital_distribution_reports" ADD COLUMN IF NOT EXISTS "confirmationLanguage" TEXT;

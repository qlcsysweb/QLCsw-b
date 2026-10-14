-- Idioma elegido por el usuario (define el idioma de sus correos). Columna opcional: ninguna cuenta existente cambia (null = español).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferredLanguage" VARCHAR(2);

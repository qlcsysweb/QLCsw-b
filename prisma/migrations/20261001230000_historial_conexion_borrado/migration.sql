-- El admin puede borrar eventos del historial de conexión (se ocultan, no se eliminan).
ALTER TABLE "api_connection_events" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);

-- Corrige el desfase entre schema.prisma (ya tenía estas columnas
-- declaradas, sin migración correspondiente) y la base de datos real, que
-- causaba 500 en /api/client/api-subaccounts y /api/client/statements
-- ("column statements.commissionWarningSentAt does not exist").
-- Ambas columnas son nuevas, nullable y sin valor por defecto: no borra ni
-- modifica ningún dato existente.
ALTER TABLE "statements" ADD COLUMN     "commissionWarningSentAt" TIMESTAMP(3);
ALTER TABLE "chat_sessions" ADD COLUMN     "expiryNotifiedAt" TIMESTAMP(3);

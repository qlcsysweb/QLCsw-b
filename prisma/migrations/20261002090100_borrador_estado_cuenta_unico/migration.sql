-- Separada de la anterior: el valor 'BORRADOR' del enum debe estar confirmado antes de usarse en un índice.
-- Máximo UN borrador de estado de cuenta por subcuenta: "Guardar borrador" siempre actualiza el mismo registro.
CREATE UNIQUE INDEX IF NOT EXISTS "statements_one_draft_per_subaccount" ON "statements" ("apiSubaccountId") WHERE "status" = 'BORRADOR';

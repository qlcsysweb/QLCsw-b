-- Estado de cuenta en preparación (BORRADOR): editable, sin PDF, invisible para el cliente.
ALTER TYPE "StatementStatus" ADD VALUE IF NOT EXISTS 'BORRADOR' BEFORE 'PENDIENTE_DE_PAGO';

-- Idempotencia de transferencias Bitget: un mismo N.º de orden no puede tener dos reportes vigentes (no rechazados).
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reports_order_number_active_key" ON "payment_reports" (UPPER("bitgetOrderNumber")) WHERE "bitgetOrderNumber" IS NOT NULL AND "status" <> 'RECHAZADO';

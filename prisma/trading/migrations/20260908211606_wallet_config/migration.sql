-- AlterTable
ALTER TABLE "payment_configuration" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USDT',
ADD COLUMN     "network" TEXT;


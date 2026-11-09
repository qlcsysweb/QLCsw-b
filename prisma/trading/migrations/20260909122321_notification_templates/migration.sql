-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "templateParams" JSONB;


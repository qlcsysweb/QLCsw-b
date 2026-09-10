-- CreateEnum
CREATE TYPE "GuideAudience" AS ENUM ('CLIENT', 'ADMIN', 'BOTH');

-- AlterEnum
ALTER TYPE "ConnectionEventType" ADD VALUE 'ACTIVATED';

-- AlterTable
ALTER TABLE "api_connection_events" ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "capital_increase_invitations" ADD COLUMN     "message" TEXT;

-- CreateTable
CREATE TABLE "guides" (
    "id" TEXT NOT NULL,
    "titleEs" TEXT NOT NULL,
    "titleEn" TEXT,
    "descriptionEs" TEXT,
    "descriptionEn" TEXT,
    "contentEs" TEXT NOT NULL,
    "contentEn" TEXT,
    "audience" "GuideAudience" NOT NULL DEFAULT 'CLIENT',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guides_pkey" PRIMARY KEY ("id")
);


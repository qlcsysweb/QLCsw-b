-- CreateTable
CREATE TABLE "drive_configuration" (
    "id" TEXT NOT NULL,
    "rootFolderId" TEXT,
    "rootFolderName" TEXT NOT NULL DEFAULT 'QLC',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_configuration_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "drive_configuration" ADD CONSTRAINT "drive_configuration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

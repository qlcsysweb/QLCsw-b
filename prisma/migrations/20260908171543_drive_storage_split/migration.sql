-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN     "driveClientFolderId" TEXT,
ADD COLUMN     "driveContractsFolderId" TEXT,
ADD COLUMN     "driveDocumentsFolderId" TEXT,
ADD COLUMN     "drivePaymentsFolderId" TEXT;

-- AlterTable
ALTER TABLE "contracts" DROP COLUMN "originalPublicId",
DROP COLUMN "originalUrl",
DROP COLUMN "signedPublicId",
DROP COLUMN "signedUrl",
ADD COLUMN     "originalDriveFileId" TEXT,
ADD COLUMN     "originalDriveFolderId" TEXT,
ADD COLUMN     "originalMimeType" TEXT,
ADD COLUMN     "originalSizeBytes" INTEGER,
ADD COLUMN     "signedDriveFileId" TEXT,
ADD COLUMN     "signedDriveFolderId" TEXT,
ADD COLUMN     "signedMimeType" TEXT,
ADD COLUMN     "signedSizeBytes" INTEGER;

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "cloudinaryPublicId",
DROP COLUMN "cloudinaryUrl",
ADD COLUMN     "driveFileId" TEXT NOT NULL,
ADD COLUMN     "driveFolderId" TEXT,
ADD COLUMN     "extension" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "payment_reports" DROP COLUMN "proofPublicId",
DROP COLUMN "proofUrl",
ADD COLUMN     "proofDriveFileId" TEXT,
ADD COLUMN     "proofDriveFolderId" TEXT,
ADD COLUMN     "proofFileName" TEXT,
ADD COLUMN     "proofMimeType" TEXT,
ADD COLUMN     "proofSizeBytes" INTEGER;


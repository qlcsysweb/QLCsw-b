-- AlterTable
ALTER TABLE "models" ADD COLUMN     "conditionsEn" TEXT,
ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "nameEn" TEXT,
ADD COLUMN     "periodEn" TEXT,
ADD COLUMN     "taglineEn" TEXT;

-- AlterTable
ALTER TABLE "public_content" ADD COLUMN     "valueEn" TEXT;

-- AlterTable
ALTER TABLE "faqs" ADD COLUMN     "answerEn" TEXT,
ADD COLUMN     "questionEn" TEXT;

-- AlterTable
ALTER TABLE "track_records" ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "titleEn" TEXT;


-- Historial básico de sustituciones de documentos ("archivo corregido").
CREATE TABLE "document_corrections" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "previousFileName" TEXT NOT NULL,
    "previousDriveFileId" TEXT NOT NULL,
    "previousMimeType" TEXT NOT NULL,
    "previousSizeBytes" INTEGER NOT NULL,
    "correctedByUserId" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_corrections_documentId_idx" ON "document_corrections"("documentId");

ALTER TABLE "document_corrections" ADD CONSTRAINT "document_corrections_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_corrections" ADD CONSTRAINT "document_corrections_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

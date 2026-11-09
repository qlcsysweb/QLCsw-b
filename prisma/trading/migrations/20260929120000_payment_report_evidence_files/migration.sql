-- Transferencia interna Bitget: el cliente adjunta evidencias (varios
-- archivos) y el reporte guarda el UID de recepción que tenía a la vista.
-- Solo cambios aditivos (los binarios se guardan en Google Drive).
ALTER TABLE "payment_reports" ADD COLUMN "receiveUid" TEXT;

CREATE TABLE "payment_report_files" (
    "id" TEXT NOT NULL,
    "paymentReportId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "driveFolderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_report_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_report_files_paymentReportId_idx" ON "payment_report_files"("paymentReportId");

ALTER TABLE "payment_report_files" ADD CONSTRAINT "payment_report_files_paymentReportId_fkey" FOREIGN KEY ("paymentReportId") REFERENCES "payment_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chat interno de citas y archivos adjuntos de consultas. Solo crea tablas nuevas.

-- CreateTable
CREATE TABLE "AppointmentMessage" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "driveFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleQuestionFile" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "uploadedByRole" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleQuestionFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentMessage_appointmentId_createdAt_idx" ON "AppointmentMessage"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ModuleQuestionFile_questionId_idx" ON "ModuleQuestionFile"("questionId");

-- AddForeignKey
ALTER TABLE "AppointmentMessage" ADD CONSTRAINT "AppointmentMessage_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleQuestionFile" ADD CONSTRAINT "ModuleQuestionFile_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ModuleQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

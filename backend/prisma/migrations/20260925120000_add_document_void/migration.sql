-- Issue #270: anulación de documentos de paciente (sin borrado físico) y
-- vínculo opcional evento de consentimiento -> documento. La FK es RESTRICT
-- para que el ledger nunca pierda la referencia a su documento.
-- Generada con `prisma migrate diff` (el shadow DB no sirve por RLS).

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_VOID';

-- AlterTable
ALTER TABLE "PatientConsent" ADD COLUMN     "documentId" TEXT;

-- AlterTable
ALTER TABLE "PatientDocument" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateIndex
CREATE INDEX "PatientConsent_documentId_idx" ON "PatientConsent"("documentId");

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PatientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

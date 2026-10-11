-- T3 (informe de alta): vincula el PDF generado (PatientDocument) al informe y
-- guarda el SHA-256 de sus bytes. Aditiva: columna nullable y FK sobre una
-- columna que hasta ahora no tenía lógica (todas las filas existentes tienen
-- documentId NULL).

-- AlterTable
ALTER TABLE "TreatmentDischarge" ADD COLUMN     "pdfSha256" TEXT;

-- CreateIndex
CREATE INDEX "TreatmentDischarge_documentId_idx" ON "TreatmentDischarge"("documentId");

-- AddForeignKey
ALTER TABLE "TreatmentDischarge" ADD CONSTRAINT "TreatmentDischarge_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PatientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

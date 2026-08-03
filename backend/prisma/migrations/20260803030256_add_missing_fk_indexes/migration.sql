-- CreateIndex
CREATE INDEX "Consultation_patientId_idx" ON "Consultation"("patientId");

-- CreateIndex
CREATE INDEX "Consultation_therapistId_idx" ON "Consultation"("therapistId");

-- CreateIndex
CREATE INDEX "ConsultationHistory_consultationId_idx" ON "ConsultationHistory"("consultationId");

-- CreateIndex
CREATE INDEX "Patient_therapistId_idx" ON "Patient"("therapistId");

-- CreateIndex
CREATE INDEX "PatientDocument_patientId_idx" ON "PatientDocument"("patientId");

-- CreateIndex
CREATE INDEX "PatientHistory_patientId_idx" ON "PatientHistory"("patientId");

-- CreateIndex
CREATE INDEX "shared_files_uploadedById_idx" ON "shared_files"("uploadedById");

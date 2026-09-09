-- issue #110: PatientsService.softDelete now cascades into
-- PaymentsService.cancelUnpaidForPatient, which filters Payment rows
-- directly on patientId (WHERE patientId = ... AND status IN (...)).
-- Every other model with a patientId foreign key (Consultation,
-- PatientDocument, PatientHistory, PatientConsent) already declares
-- @@index([patientId]) for the same reason -- Payment didn't need it until
-- this new per-patient query existed.

-- CreateIndex
CREATE INDEX "Payment_patientId_idx" ON "Payment"("patientId");

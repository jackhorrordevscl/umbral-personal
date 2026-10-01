-- Issue #314: Patient.rut pasa de único global a único por terapeuta.

-- DropIndex
DROP INDEX "Patient_rut_key";

-- CreateIndex
CREATE UNIQUE INDEX "Patient_therapistId_rut_key" ON "Patient"("therapistId", "rut");

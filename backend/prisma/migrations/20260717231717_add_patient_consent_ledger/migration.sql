/*
  Warnings:

  - You are about to drop the column `consentSigned` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `telemedConsentSigned` on the `Patient` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('TREATMENT', 'TELEMEDICINE', 'HEALTH_NETWORK');

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('GRANT', 'REVOKE');

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientConsent_patientId_purpose_idx" ON "PatientConsent"("patientId", "purpose");

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (T6.1, issue #27, code review finding): preservar como eventos
-- GRANT el estado previo de consentSigned/telemedConsentSigned ANTES de
-- borrar esas columnas, para no perder evidencia de consentimientos ya
-- otorgados por pacientes reales. Se usa el terapeuta asignado del paciente
-- como actor que registra el evento (no había un actor propio guardado en
-- el booleano original) y createdAt del paciente como fecha del evento, ya
-- que tampoco existía una fecha de otorgamiento explícita.
INSERT INTO "PatientConsent" ("id", "patientId", "purpose", "action", "recordedById", "recordedAt", "evidence")
SELECT gen_random_uuid(), "id", 'TREATMENT', 'GRANT', "therapistId", "createdAt",
  'Migrado automáticamente desde Patient.consentSigned al introducir el ledger de consentimiento granular (T6.1, issue #27)'
FROM "Patient"
WHERE "consentSigned" = true;

INSERT INTO "PatientConsent" ("id", "patientId", "purpose", "action", "recordedById", "recordedAt", "evidence")
SELECT gen_random_uuid(), "id", 'TELEMEDICINE', 'GRANT', "therapistId", "createdAt",
  'Migrado automáticamente desde Patient.telemedConsentSigned al introducir el ledger de consentimiento granular (T6.1, issue #27)'
FROM "Patient"
WHERE "telemedConsentSigned" = true;

-- AlterTable
ALTER TABLE "Patient" DROP COLUMN "consentSigned",
DROP COLUMN "telemedConsentSigned";

-- Menores de edad y representante legal (M1). Migración aditiva: tablas y
-- enums nuevos, y dos columnas en PatientConsent (grantedBy con default
-- 'PATIENT' y guardianId nullable), así que las filas existentes conservan su
-- significado (consentimiento otorgado por el propio paciente). Sin backfill.

-- CreateEnum
CREATE TYPE "ConsentGrantor" AS ENUM ('PATIENT', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('MOTHER', 'FATHER', 'LEGAL_GUARDIAN', 'CURATOR', 'CAREGIVER', 'OTHER');

-- CreateEnum
CREATE TYPE "CustodyType" AS ENUM ('SOLE', 'SHARED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AssentAgeBand" AS ENUM ('UNDER_14', 'AGE_14_17');

-- CreateEnum
CREATE TYPE "AssentAction" AS ENUM ('GRANTED', 'REFUSED', 'WITHDRAWN', 'INFORMED_AND_HEARD');

-- AlterTable
ALTER TABLE "PatientConsent" ADD COLUMN     "grantedBy" "ConsentGrantor" NOT NULL DEFAULT 'PATIENT',
ADD COLUMN     "guardianId" TEXT;

-- CreateTable
CREATE TABLE "LegalGuardian" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "isPayer" BOOLEAN NOT NULL DEFAULT false,
    "receivesCommunications" BOOLEAN NOT NULL DEFAULT true,
    "canAccessReports" BOOLEAN NOT NULL DEFAULT true,
    "canConsent" BOOLEAN NOT NULL DEFAULT true,
    "custody" "CustodyType" NOT NULL DEFAULT 'UNKNOWN',
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalGuardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAssent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "ageBand" "AssentAgeBand" NOT NULL,
    "action" "AssentAction" NOT NULL,
    "note" TEXT,
    "documentId" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAssent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalGuardian_patientId_idx" ON "LegalGuardian"("patientId");

-- CreateIndex
CREATE INDEX "PatientAssent_patientId_recordedAt_idx" ON "PatientAssent"("patientId", "recordedAt");

-- CreateIndex
CREATE INDEX "PatientAssent_documentId_idx" ON "PatientAssent"("documentId");

-- CreateIndex
CREATE INDEX "PatientConsent_guardianId_idx" ON "PatientConsent"("guardianId");

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "LegalGuardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalGuardian" ADD CONSTRAINT "LegalGuardian_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAssent" ADD CONSTRAINT "PatientAssent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAssent" ADD CONSTRAINT "PatientAssent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PatientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAssent" ADD CONSTRAINT "PatientAssent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Misma convención que la migración 20260804170000: toda tabla nueva del schema public habilita RLS deny-all (sin policies). El rol de
-- runtime tiene rolbypassrls=true, así que no cambia nada para la app.
ALTER TABLE "LegalGuardian" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientAssent" ENABLE ROW LEVEL SECURITY;

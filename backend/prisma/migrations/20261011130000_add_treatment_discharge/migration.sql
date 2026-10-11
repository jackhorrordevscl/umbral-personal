-- Informe de alta (T2): modelo TreatmentDischarge (borrador, emision con hash y
-- correcciones versionadas) y la FK pendiente de Consultation.cancelledByDischargeId.
-- Migracion aditiva: solo crea tipos, una tabla nueva y una FK sobre una columna
-- que T1 dejo en NULL para todas las filas.

-- CreateEnum
CREATE TYPE "DischargeSource" AS ENUM ('GENERATED', 'UPLOADED');

-- CreateEnum
CREATE TYPE "DischargeStatus" AS ENUM ('DRAFT', 'ISSUED');

-- CreateTable
CREATE TABLE "TreatmentDischarge" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "correctsId" TEXT,
    "source" "DischargeSource" NOT NULL DEFAULT 'GENERATED',
    "status" "DischargeStatus" NOT NULL DEFAULT 'DRAFT',
    "closureReason" "TreatmentStatus" NOT NULL,
    "dropoutReason" "DropoutReason",
    "dropoutNote" TEXT,
    "referralDestination" TEXT,
    "admissionDate" DATE NOT NULL,
    "dischargeDate" DATE NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "consultReason" TEXT NOT NULL DEFAULT '',
    "diagnosis" TEXT,
    "evolutionSummary" TEXT NOT NULL DEFAULT '',
    "statusAtDischarge" TEXT NOT NULL DEFAULT '',
    "recommendations" TEXT NOT NULL DEFAULT '',
    "signerName" TEXT,
    "signerRut" TEXT,
    "signerProfessionalRegistration" TEXT,
    "issuedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentDischarge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentDischarge_correctsId_key" ON "TreatmentDischarge"("correctsId");

-- CreateIndex
CREATE INDEX "TreatmentDischarge_patientId_idx" ON "TreatmentDischarge"("patientId");

-- CreateIndex
CREATE INDEX "TreatmentDischarge_therapistId_idx" ON "TreatmentDischarge"("therapistId");

-- CreateIndex
CREATE INDEX "TreatmentDischarge_groupId_idx" ON "TreatmentDischarge"("groupId");

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_cancelledByDischargeId_fkey" FOREIGN KEY ("cancelledByDischargeId") REFERENCES "TreatmentDischarge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentDischarge" ADD CONSTRAINT "TreatmentDischarge_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentDischarge" ADD CONSTRAINT "TreatmentDischarge_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentDischarge" ADD CONSTRAINT "TreatmentDischarge_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "TreatmentDischarge"("id") ON DELETE SET NULL ON UPDATE CASCADE;


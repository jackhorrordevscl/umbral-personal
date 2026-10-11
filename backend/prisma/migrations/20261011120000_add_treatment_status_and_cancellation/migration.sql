-- Informe de alta (T1): estado de tratamiento, motivos de deserción y campos
-- de cancelación de consultas. Migración aditiva: ninguna columna existente
-- cambia y los pacientes actuales quedan en ACTIVE por el default.
-- Consultation.cancelledByDischargeId no tiene FK todavía: el modelo
-- TreatmentDischarge nace en T2.

-- CreateEnum
CREATE TYPE "TreatmentStatus" AS ENUM ('ACTIVE', 'DISCHARGED', 'REFERRED', 'DROPPED_OUT');

-- CreateEnum
CREATE TYPE "DropoutReason" AS ENUM ('IMPROVEMENT_WITHOUT_AGREED_DISCHARGE', 'NO_PERCEIVED_IMPROVEMENT', 'DISSATISFACTION_WITH_BOND_OR_APPROACH', 'COST', 'SCHEDULE_CONFLICT', 'LOW_MOTIVATION_OR_STIGMA', 'PREFERS_ALTERNATIVE', 'THERAPIST_REFERRAL', 'RELOCATION_OR_ACCESS', 'HEALTH_ISSUE', 'OTHER_LIFE_EVENT', 'OTHER', 'NO_CONTACT');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'DISCHARGE_REPORT';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'TREATMENT_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'CONSULTATION_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'DISCHARGE_ISSUE';
ALTER TYPE "AuditAction" ADD VALUE 'DISCHARGE_DELIVER';
ALTER TYPE "AuditAction" ADD VALUE 'DISCHARGE_CORRECT';

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "treatmentStatus" "TreatmentStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByDischargeId" TEXT;

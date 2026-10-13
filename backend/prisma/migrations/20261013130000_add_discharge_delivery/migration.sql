-- T4 (informe de alta): registro de entregas del informe. Aditiva: una tabla
-- nueva, dos enums nuevos y un valor nuevo de DocumentType para la autorización
-- de entrega a terceros. No toca filas existentes.

-- CreateEnum
CREATE TYPE "DischargeRecipientType" AS ENUM ('PATIENT', 'GUARDIAN', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "DischargeDeliveryChannel" AS ENUM ('IN_PERSON', 'EMAIL', 'POSTAL', 'OTHER');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'DELIVERY_AUTHORIZATION';

-- CreateTable
CREATE TABLE "DischargeDelivery" (
    "id" TEXT NOT NULL,
    "dischargeId" TEXT NOT NULL,
    "recipientType" "DischargeRecipientType" NOT NULL,
    "recipientName" TEXT NOT NULL,
    "guardianId" TEXT,
    "purpose" TEXT NOT NULL,
    "channel" "DischargeDeliveryChannel" NOT NULL,
    "authorizationDocumentId" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DischargeDelivery_pkey" PRIMARY KEY ("id")
);

-- Sin políticas: deny-all para la API REST de Supabase (PostgREST); el backend
-- accede con el rol dueño de la tabla.
ALTER TABLE "DischargeDelivery" ENABLE ROW LEVEL SECURITY;

-- CreateIndex
CREATE INDEX "DischargeDelivery_dischargeId_idx" ON "DischargeDelivery"("dischargeId");

-- CreateIndex
CREATE INDEX "DischargeDelivery_guardianId_idx" ON "DischargeDelivery"("guardianId");

-- CreateIndex
CREATE INDEX "DischargeDelivery_authorizationDocumentId_idx" ON "DischargeDelivery"("authorizationDocumentId");

-- AddForeignKey
ALTER TABLE "DischargeDelivery" ADD CONSTRAINT "DischargeDelivery_dischargeId_fkey" FOREIGN KEY ("dischargeId") REFERENCES "TreatmentDischarge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeDelivery" ADD CONSTRAINT "DischargeDelivery_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "LegalGuardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeDelivery" ADD CONSTRAINT "DischargeDelivery_authorizationDocumentId_fkey" FOREIGN KEY ("authorizationDocumentId") REFERENCES "PatientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

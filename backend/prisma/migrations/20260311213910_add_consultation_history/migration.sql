/*
  Warnings:

  - You are about to drop the column `isCorrected` on the `Consultation` table. All the data in the column will be lost.
  - You are about to drop the column `previousVersionId` on the `Consultation` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `Consultation` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Consultation" DROP COLUMN "isCorrected",
DROP COLUMN "previousVersionId",
DROP COLUMN "version";

-- CreateTable
CREATE TABLE "ConsultationHistory" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "ConsultationHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ConsultationHistory" ADD CONSTRAINT "ConsultationHistory_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationHistory" ADD CONSTRAINT "ConsultationHistory_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

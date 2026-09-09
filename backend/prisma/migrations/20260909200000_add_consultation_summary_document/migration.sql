-- Sugerencia de usuarios: permitir subir el resumen/registro de sesión
-- (PDF o Word) propio del terapeuta al crear una consulta, atado a esa
-- sesión puntual. `consultationGroupId` guarda Consultation.groupId (no
-- Consultation.id) -- mismo patrón que Payment.groupId/
-- ReminderDispatch.groupId, sobrevive a correct() (una corrección de la
-- consulta no debe desvincular el documento ya subido).
--
-- AlterEnum: Postgres no permite consumir un valor de enum recién agregado
-- (ALTER TYPE ... ADD VALUE) en la misma transacción que lo agrega -- por
-- eso este archivo solo agrega el valor, ninguna sentencia posterior lo usa.
-- AlterTable
ALTER TABLE "PatientDocument" ADD COLUMN "consultationGroupId" TEXT;

-- CreateIndex
CREATE INDEX "PatientDocument_consultationGroupId_idx" ON "PatientDocument"("consultationGroupId");

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SESSION_SUMMARY';

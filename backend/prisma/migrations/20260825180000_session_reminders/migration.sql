-- sdd/session-reminders PR 2: log de despachos de recordatorios de sesión.
-- `Consultation.reminderSent` está muerto desde el schema original (siempre
-- false, nunca leído fuera del copy-forward de correct()) y queda reemplazado
-- por esta tabla, indexada por (groupId, sessionDate, offsetKind, channel) --
-- la garantía de "a lo más un envío" es esta restricción @@unique, no lógica
-- de aplicación.

-- DropColumn
ALTER TABLE "Consultation" DROP COLUMN "reminderSent";

-- CreateEnum
CREATE TYPE "ReminderOffset" AS ENUM ('H24', 'H2');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "ReminderDispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "ReminderDispatch" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "offsetKind" "ReminderOffset" NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "consultationId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "status" "ReminderDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderDispatch_consultationId_idx" ON "ReminderDispatch"("consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDispatch_groupId_sessionDate_offsetKind_channel_key" ON "ReminderDispatch"("groupId", "sessionDate", "offsetKind", "channel");

-- AddForeignKey
ALTER TABLE "ReminderDispatch" ADD CONSTRAINT "ReminderDispatch_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Misma convención que las migraciones 20260804170000 y 20260825170000
-- (issue "rls_disabled_in_public"): toda tabla nueva del schema public debe
-- habilitar RLS deny-all (sin policies) para cerrar la exposición vía la API
-- PostgREST autogenerada de Supabase. El rol de runtime (DATABASE_URL/
-- DIRECT_URL) tiene rolbypassrls=true, así que esto no cambia nada para la
-- app.
ALTER TABLE "ReminderDispatch" ENABLE ROW LEVEL SECURITY;

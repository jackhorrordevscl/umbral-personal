-- sdd/session-reminders PR 1: modelo genérico de notificaciones in-app,
-- dueño-scoped por userId. Tabla nueva y aditiva, ningún dato existente se
-- toca. `type` es el único punto de extensión para futuras fuentes
-- (reminders en PR 2, google-calendar-sync más adelante).

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SESSION_REMINDER');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkPath" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Misma convención que la migración 20260804170000 (issue "rls_disabled_in_public"):
-- toda tabla nueva del schema public debe habilitar RLS deny-all (sin
-- policies) para cerrar la exposición vía la API PostgREST autogenerada de
-- Supabase. El rol de runtime (DATABASE_URL/DIRECT_URL) tiene
-- rolbypassrls=true, así que esto no cambia nada para la app.
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

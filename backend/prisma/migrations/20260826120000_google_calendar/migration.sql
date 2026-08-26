-- sdd/google-calendar-integration PR 1: conexión OAuth de Google Calendar
-- por terapeuta (nunca por sesión) + mapeo de eventos por (connectionId,
-- groupId) -- este PR solo agrega el schema y la custodia del refresh token;
-- CalendarEventLink se consume recién en PR 2 (CalendarSyncService).
-- Puramente aditivo: ninguna tabla/columna existente se modifica o elimina.

-- CreateEnum
CREATE TYPE "GoogleConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "GoogleDisconnectReason" AS ENUM ('USER_REQUEST', 'INVALID_GRANT');

-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('SYNCED', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'GOOGLE_CALENDAR_DISCONNECTED';

-- CreateTable
CREATE TABLE "GoogleCalendarConnection" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "status" "GoogleConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "disconnectReason" "GoogleDisconnectReason",
    "googleAccountEmail" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "refreshTokenEncrypted" BYTEA,
    "scope" TEXT,
    "stateNonceHash" TEXT,
    "stateExpiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventLink" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "lastSessionDate" TIMESTAMP(3) NOT NULL,
    "syncStatus" "CalendarSyncStatus" NOT NULL DEFAULT 'SYNCED',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarConnection_therapistId_key" ON "GoogleCalendarConnection"("therapistId");

-- CreateIndex
CREATE INDEX "CalendarEventLink_syncStatus_idx" ON "CalendarEventLink"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventLink_connectionId_groupId_key" ON "CalendarEventLink"("connectionId", "groupId");

-- AddForeignKey
ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleCalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Misma convención que las migraciones 20260804170000, 20260825170000 y
-- 20260825180000 (issue "rls_disabled_in_public"): toda tabla nueva del
-- schema public debe habilitar RLS deny-all (sin policies) para cerrar la
-- exposición vía la API PostgREST autogenerada de Supabase. El rol de
-- runtime (DATABASE_URL/DIRECT_URL) tiene rolbypassrls=true, así que esto no
-- cambia nada para la app -- más relevante todavía acá, porque
-- "GoogleCalendarConnection" guarda el refresh token cifrado.
ALTER TABLE "GoogleCalendarConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEventLink" ENABLE ROW LEVEL SECURITY;

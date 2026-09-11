-- sdd/public-booking-payment-calendar PR 1 (design.md Decision 3 "Postgres
-- table, not in-memory and not Redis"): per-therapist overlay cache of
-- Google free-busy intervals, same shape/index as AvailabilityBlockout.
-- Purely additive: no existing table is touched besides the two new
-- nullable columns on GoogleCalendarConnection tracking the busy-refresh
-- job's own sync state (busySyncedAt/busySyncError), separate from the
-- existing push-sync lastSyncAt/lastError.

-- AlterTable
ALTER TABLE "GoogleCalendarConnection" ADD COLUMN     "busySyncedAt" TIMESTAMP(3),
ADD COLUMN     "busySyncError" TEXT;

-- CreateTable
CREATE TABLE "CalendarBusyBlock" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarBusyBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarBusyBlock_therapistId_startsAt_idx" ON "CalendarBusyBlock"("therapistId", "startsAt");

-- AddForeignKey
ALTER TABLE "CalendarBusyBlock" ADD CONSTRAINT "CalendarBusyBlock_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Misma convención que las migraciones 20260804170000, 20260825170000,
-- 20260825180000, 20260826120000, 20260828190000, 20260909190000 y
-- 20260911120000 (issue "rls_disabled_in_public"): toda tabla nueva del
-- schema public debe habilitar RLS deny-all (sin policies) para cerrar la
-- exposición vía la API PostgREST autogenerada de Supabase. El rol de
-- runtime (DATABASE_URL/DIRECT_URL) tiene rolbypassrls=true, así que esto no
-- cambia nada para la app.
ALTER TABLE "CalendarBusyBlock" ENABLE ROW LEVEL SECURITY;

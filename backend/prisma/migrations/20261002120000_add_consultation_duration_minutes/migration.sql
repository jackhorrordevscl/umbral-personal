-- Issue #336: each Consultation stores the duration it was booked with, so
-- occupancy no longer depends on the therapist's CURRENT sessionDurationMinutes.

-- 1) Nullable first so existing rows can be backfilled.
ALTER TABLE "Consultation" ADD COLUMN "durationMinutes" INTEGER;

-- 2) Backfill from the therapist's configured duration; therapists without one
--    fall back to DEFAULT_SESSION_MINUTES (50, calendar-integration.constants).
UPDATE "Consultation" AS c
SET "durationMinutes" = COALESCE(u."sessionDurationMinutes", 50)
FROM "User" AS u
WHERE u."id" = c."therapistId";

-- Safety net for rows without a matching therapist (should not exist: FK).
UPDATE "Consultation" SET "durationMinutes" = 50 WHERE "durationMinutes" IS NULL;

-- 3) Enforce.
ALTER TABLE "Consultation" ALTER COLUMN "durationMinutes" SET NOT NULL;

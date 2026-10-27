-- issue #487: límite de intentos del segundo factor por cuenta (MfaAttemptLimiter).
-- Aditiva: el contador arranca en 0 y las fechas en NULL para todas las filas
-- existentes, así que ninguna cuenta queda bloqueada el día del deploy.
ALTER TABLE "User" ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "mfaFailedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

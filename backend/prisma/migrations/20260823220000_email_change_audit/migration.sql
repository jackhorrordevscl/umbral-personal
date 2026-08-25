-- Issue #76: estado pendiente del cambio de email self-service (PATCH
-- /profile) y las nuevas AuditAction del flujo de step-up/email-change.
-- Ambas columnas nuevas son nullable y sin backfill -- ningún usuario
-- existente queda con un cambio de email pendiente al desplegar esto.
--
-- Nuevas columnas heredan las RLS policies ya existentes sobre "User"
-- (20260804170000_enable_rls_public_tables): RLS es deny-all a nivel de fila
-- para los roles `anon`/`authenticated` de PostgREST, no depende de qué
-- columnas tenga la tabla, así que no hace falta ninguna policy nueva acá.
--
-- AlterEnum: Postgres no permite consumir un valor de enum recién agregado
-- (ALTER TYPE ... ADD VALUE) en la misma transacción que lo agrega -- por
-- eso este archivo solo agrega los valores, ninguna sentencia posterior los
-- usa.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "pendingEmail" TEXT,
ADD COLUMN "pendingEmailTokenIssuedAt" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EMAIL_CHANGE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'EMAIL_CHANGE_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_CHANGED';

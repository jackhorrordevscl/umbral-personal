-- sdd/payments-multigateway-redesign M1 (design.md "Decision 3 — Prisma
-- migration"): schema-only step, safe to deploy standalone -- old code
-- neither writes nor reads RECONNECT_REQUIRED, and the new columns are
-- nullable/defaulted so every existing PaymentAccount row stays valid.
-- M2 (a separate, later data migration run only after the new backend is
-- live) flips existing CONNECTED rows to RECONNECT_REQUIRED; Postgres
-- forbids using an enum value added in the same transaction that adds it,
-- which is why M1 and M2 are two migration files, not one.

-- AlterEnum
ALTER TYPE "PaymentAccountStatus" ADD VALUE 'RECONNECT_REQUIRED';

-- AlterTable
ALTER TABLE "PaymentAccount" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "keyFingerprint" TEXT;

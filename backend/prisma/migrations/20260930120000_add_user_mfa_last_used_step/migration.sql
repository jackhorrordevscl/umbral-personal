-- Issue #302: last accepted TOTP time step, used to reject replayed codes.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastUsedStep" INTEGER;

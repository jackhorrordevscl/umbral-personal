-- AlterTable
ALTER TABLE "ReminderDispatch" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "resendMessageId" TEXT;

-- CreateIndex
CREATE INDEX "ReminderDispatch_resendMessageId_idx" ON "ReminderDispatch"("resendMessageId");


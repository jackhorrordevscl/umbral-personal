-- Issue #611 (PR 4): avisos de vencimiento. Valor de enum y tabla nuevos; sin datos que migrar.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_EXPIRING';

-- CreateTable
CREATE TABLE "SubscriptionReminder" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "sent" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionReminder_subscriptionId_periodEnd_offsetDays_key" ON "SubscriptionReminder"("subscriptionId", "periodEnd", "offsetDays");

-- AddForeignKey
ALTER TABLE "SubscriptionReminder" ADD CONSTRAINT "SubscriptionReminder_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS activado como en el resto de las tablas de suscripción.
ALTER TABLE "SubscriptionReminder" ENABLE ROW LEVEL SECURITY;

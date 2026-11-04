-- Issue #611: aviso previo al cambio de precio. Valor de enum y tabla nuevos; sin datos que migrar.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_PRICE_CHANGE';

-- CreateTable
CREATE TABLE "SubscriptionPriceNotice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "priceChangeAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPriceNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPriceNotice_subscriptionId_priceChangeAt_key" ON "SubscriptionPriceNotice"("subscriptionId", "priceChangeAt");

-- AddForeignKey
ALTER TABLE "SubscriptionPriceNotice" ADD CONSTRAINT "SubscriptionPriceNotice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS activado como en el resto de las tablas de suscripción.
ALTER TABLE "SubscriptionPriceNotice" ENABLE ROW LEVEL SECURITY;

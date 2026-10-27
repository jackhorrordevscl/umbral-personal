-- Issue #611 (PR 2): token de la orden de Flow para ubicar el pago al confirmar.
-- AlterTable
ALTER TABLE "SubscriptionPayment" ADD COLUMN "flowToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_flowToken_key" ON "SubscriptionPayment"("flowToken");

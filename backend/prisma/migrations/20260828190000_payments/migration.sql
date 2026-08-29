-- sdd/online-payment-integration PR 1: cargos automáticos por sesión,
-- cobrados a través de la cuenta Flow propia de cada terapeuta (split
-- Comercios Asociados). Este PR solo agrega el schema + el ciclo de vida
-- del cargo (PaymentsService.ensureCharge/updateAmount/cancelUnpaid);
-- FlowPaymentGatewayClient, el checkout público y el cron de vencimiento
-- llegan en PR 2. Puramente aditivo: ninguna tabla/columna existente se
-- modifica o elimina.

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'LATE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentLinkDelivery" AS ENUM ('PENDING', 'SENT', 'SKIPPED_NO_EMAIL', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('FLOW');

-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_LATE';

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "defaultSessionAmount" INTEGER;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "gatewayToken" TEXT,
    "gatewayPaymentId" TEXT,
    "paymentUrl" TEXT,
    "linkDelivery" "PaymentLinkDelivery" NOT NULL DEFAULT 'PENDING',
    "linkSentAt" TIMESTAMP(3),
    "lateNotifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "orderIssuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'FLOW',
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'PENDING',
    "merchantId" TEXT,
    "credentialEncrypted" BYTEA,
    "connectedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_groupId_key" ON "Payment"("groupId");

-- CreateIndex
CREATE INDEX "Payment_status_dueDate_idx" ON "Payment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Payment_therapistId_idx" ON "Payment"("therapistId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_therapistId_key" ON "PaymentAccount"("therapistId");

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Misma convención que las migraciones 20260804170000, 20260825170000,
-- 20260825180000 y 20260826120000 (issue "rls_disabled_in_public"): toda
-- tabla nueva del schema public debe habilitar RLS deny-all (sin policies)
-- para cerrar la exposición vía la API PostgREST autogenerada de Supabase.
-- El rol de runtime (DATABASE_URL/DIRECT_URL) tiene rolbypassrls=true, así
-- que esto no cambia nada para la app -- más relevante todavía acá, porque
-- "PaymentAccount" guarda la credencial cifrada del merchant.
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAccount" ENABLE ROW LEVEL SECURITY;

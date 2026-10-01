-- Issue #284: nuevo miembro del enum "NotificationType" para avisar al
-- terapeuta de un pago de la pasarela que el cobro local no puede representar.
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_ANOMALY';

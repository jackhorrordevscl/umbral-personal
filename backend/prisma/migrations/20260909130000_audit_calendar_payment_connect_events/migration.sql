-- issue #119: conectar/desconectar Google Calendar o una cuenta de pagos
-- (Flow) no dejaba ningún rastro en AuditLog, a diferencia de acciones
-- comparablemente sensibles como MFA_ENABLED/MFA_DISABLED. Puramente
-- aditivo: ninguna tabla/columna existente se modifica o elimina.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CALENDAR_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'CALENDAR_DISCONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_ACCOUNT_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_ACCOUNT_DISCONNECTED';

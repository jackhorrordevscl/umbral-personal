import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'audit:skip';

// Excluye un handler del registro del AuditInterceptor global. Pensado para
// endpoints de sondeo (p. ej. el contador de notificaciones, que el frontend
// consulta cada 30 s) cuyo registro solo agrega ruido a la bitácora.
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

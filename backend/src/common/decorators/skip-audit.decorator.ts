import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'audit:skip';

export interface SkipAuditOptions {
  // El handler no escribe la fila genérica del éxito, pero un 403/404 sobre un
  // recurso clínico igual queda como UNAUTHORIZED_ATTEMPT. Para los handlers
  // cuyo servicio registra su propia fila del éxito: el servicio nunca llega a
  // auditar un acceso denegado.
  keepDenied?: boolean;
}

// Excluye un handler del registro del AuditInterceptor global. Pensado para
// endpoints de sondeo (p. ej. el contador de notificaciones, que el frontend
// consulta cada 30 s) cuyo registro solo agrega ruido a la bitácora.
export const SkipAudit = (options: SkipAuditOptions = {}) =>
  SetMetadata(SKIP_AUDIT_KEY, options);

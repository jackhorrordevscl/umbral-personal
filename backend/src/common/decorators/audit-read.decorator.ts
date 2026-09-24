import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@prisma/client';

export const AUDIT_READ_KEY = 'audit:read';

export interface AuditReadOptions {
  // Sobrescribe la acción por defecto (GET -> VIEW) en el registro de auditoría.
  action?: AuditAction;
  // Marca adicional que se agrega al detalle (por ejemplo 'download').
  detail?: string;
}

// Enriquece el registro que el AuditInterceptor global ya genera para un
// handler de lectura (descargas, exportaciones), sin cambiar su resourceId.
export const AuditRead = (options: AuditReadOptions = {}) =>
  SetMetadata(AUDIT_READ_KEY, options);

import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@prisma/client';

export const AUDIT_READ_KEY = 'audit:read';

export interface AuditReadOptions {
  // Sobrescribe la acción por defecto (GET -> VIEW) en el registro de auditoría.
  action?: AuditAction;
  // Marca adicional que se agrega al detalle (por ejemplo 'download').
  detail?: string;
  // La fila de auditoría se escribe y se espera ANTES de entregar la respuesta;
  // si el insert falla, el request responde 500 y no sale nada. Para salidas de
  // datos que nunca deben ocurrir sin rastro (p. ej. la exportación de la ficha).
  // Requiere que el handler devuelva su respuesta (sin @Res() sin passthrough).
  failClosed?: boolean;
}

// Enriquece el registro que el AuditInterceptor global ya genera para un
// handler de lectura (descargas, exportaciones), sin cambiar su resourceId.
export const AuditRead = (options: AuditReadOptions = {}) =>
  SetMetadata(AUDIT_READ_KEY, options);

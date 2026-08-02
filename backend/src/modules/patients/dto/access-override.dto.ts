import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// T6.5 (issue #52): motivo obligatorio para el acceso excepcional de
// SUPERVISOR a una ficha sin consentimiento HEALTH_NETWORK vigente. Mismo
// patrón que RecordConsentDto.evidence -- un motivo vacío o trivial no
// sirve como justificación auditable.
//
// El campo se llama `overrideReason`, no `reason`, a propósito: coincide
// 1:1 con la columna AuditLog.overrideReason, y AuditInterceptor lee ese
// mismo nombre de `request.body` de forma genérica (no acoplada a esta
// ruta puntual) para adjuntarlo al log automático de cualquier request que
// lo traiga.
export class AccessOverrideDto {
  // Trim ANTES de validar: sin esto, un motivo de puros espacios pasa
  // @IsNotEmpty (que solo rechaza el string vacío exacto) y @MinLength (que
  // cuenta caracteres crudos, espacios incluidos) -- exactamente el "motivo
  // trivial" que el comentario de arriba dice que no debería servir.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Debe indicar el motivo del acceso excepcional' })
  @MinLength(10, { message: 'El motivo debe tener al menos 10 caracteres' })
  overrideReason: string;
}

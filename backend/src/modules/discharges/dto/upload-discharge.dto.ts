import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { DropoutReason } from '@prisma/client';
import {
  CLOSURE_REASONS,
  type ClosureReasonValue,
} from './create-discharge.dto';
import {
  DISCHARGE_LIMITS,
  DateOnly,
  OptionalShortText,
} from './discharge-fields';

// En multipart todo llega como texto: un campo vacío equivale a no enviarlo.
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

// Campos del cierre para subir el PDF propio del terapeuta (T3b). Mismas
// reglas que el borrador (assertClosureRules las aplica en el servicio). No se
// piden motivo, evolución ni recomendaciones: ese contenido vive en el PDF.
// Nada de source, status, hashes, versión, firmante ni ids: la whitelist global
// (forbidNonWhitelisted) los rechaza.
export class UploadDischargeDto {
  @IsIn(CLOSURE_REASONS)
  closureReason: ClosureReasonValue;

  // YYYY-MM-DD; por defecto, hoy (en Chile) o, en una corrección, la fecha de
  // alta de la versión corregida.
  @Transform(emptyToUndefined)
  @DateOnly()
  dischargeDate?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEnum(DropoutReason)
  dropoutReason?: DropoutReason;

  @OptionalShortText(DISCHARGE_LIMITS.dropoutNote)
  dropoutNote?: string | null;

  @OptionalShortText(DISCHARGE_LIMITS.referralDestination)
  referralDestination?: string | null;
}

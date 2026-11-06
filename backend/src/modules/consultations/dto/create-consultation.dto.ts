import {
  IsString,
  MaxLength,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { IsStrictDateString } from '../../../common/validators/is-strict-date-string.decorator';

// Issue #634: topes de los textos libres de la consulta (cifrados por campo);
// el de motivo coincide con el del informe de alta.
export const CONSULTATION_LIMITS = {
  consultReason: 2000,
  intervention: 5000,
  agreements: 5000,
} as const;

export enum SessionType {
  IN_PERSON = 'IN_PERSON',
  TELEMED = 'TELEMED',
}

export class CreateConsultationDto {
  @IsString()
  patientId: string;

  @IsStrictDateString()
  sessionDate: string;

  @IsString()
  @MaxLength(CONSULTATION_LIMITS.consultReason)
  consultReason: string;

  @IsString()
  @MaxLength(CONSULTATION_LIMITS.intervention)
  intervention: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONSULTATION_LIMITS.agreements)
  agreements?: string;

  @IsOptional()
  @IsStrictDateString()
  nextSessionDate?: string;

  @IsOptional()
  @IsEnum(SessionType)
  sessionType?: SessionType;

  @IsOptional()
  @IsStrictDateString()
  scheduledAt?: string;

  // Confirmación explícita para agendar a un paciente con el tratamiento
  // cerrado (alta, derivación, deserción): lo devuelve a ACTIVE en la misma
  // transacción. Sin esto, crear la consulta responde 409.
  @IsOptional()
  @IsBoolean()
  reopenPatient?: boolean;
}

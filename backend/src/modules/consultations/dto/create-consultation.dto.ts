import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { IsStrictDateString } from '../../../common/validators/is-strict-date-string.decorator';

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
  consultReason: string;

  @IsString()
  intervention: string;

  @IsOptional()
  @IsString()
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

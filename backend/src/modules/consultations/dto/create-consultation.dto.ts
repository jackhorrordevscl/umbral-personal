import { IsString, IsOptional, IsEnum } from 'class-validator';
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
}

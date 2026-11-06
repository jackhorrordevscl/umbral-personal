import { IsString, MaxLength, IsOptional, IsEnum } from 'class-validator';
import { IsStrictDateString } from '../../../common/validators/is-strict-date-string.decorator';
import { CONSULTATION_LIMITS, SessionType } from './create-consultation.dto';

export class CorrectConsultationDto {
  @IsOptional()
  @IsStrictDateString()
  sessionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONSULTATION_LIMITS.consultReason)
  consultReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONSULTATION_LIMITS.intervention)
  intervention?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONSULTATION_LIMITS.agreements)
  agreements?: string;

  @IsOptional()
  @IsStrictDateString()
  nextSessionDate?: string | null;

  @IsOptional()
  @IsEnum(SessionType)
  sessionType?: SessionType;
}

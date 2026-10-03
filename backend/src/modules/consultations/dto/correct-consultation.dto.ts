import { IsString, IsOptional, IsEnum } from 'class-validator';
import { IsStrictDateString } from '../../../common/validators/is-strict-date-string.decorator';
import { SessionType } from './create-consultation.dto';

export class CorrectConsultationDto {
  @IsOptional()
  @IsStrictDateString()
  sessionDate?: string;

  @IsOptional()
  @IsString()
  consultReason?: string;

  @IsOptional()
  @IsString()
  intervention?: string;

  @IsOptional()
  @IsString()
  agreements?: string;

  @IsOptional()
  @IsStrictDateString()
  nextSessionDate?: string | null;

  @IsOptional()
  @IsEnum(SessionType)
  sessionType?: SessionType;
}

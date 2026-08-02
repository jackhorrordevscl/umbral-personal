import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { SessionType } from './create-consultation.dto';

export class CorrectConsultationDto {
  @IsOptional()
  @IsDateString()
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
  @IsDateString()
  nextSessionDate?: string;

  @IsOptional()
  @IsEnum(SessionType)
  sessionType?: SessionType;
}
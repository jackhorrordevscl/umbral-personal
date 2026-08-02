import {
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';

export enum SessionType {
  IN_PERSON = 'IN_PERSON',
  TELEMED = 'TELEMED',
}

export class CreateConsultationDto {
  @IsString()
  patientId: string;

  @IsDateString()
  sessionDate: string;

  @IsString()
  consultReason: string;

  @IsString()
  intervention: string;

  @IsOptional()
  @IsString()
  agreements?: string;

  @IsOptional()
  @IsDateString()
  nextSessionDate?: string;

  @IsOptional()
  @IsEnum(SessionType)
  sessionType?: SessionType;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  patientRut?: string;
}
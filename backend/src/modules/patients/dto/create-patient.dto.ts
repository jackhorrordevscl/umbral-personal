import {
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreatePatientDto {
  @IsString()
  fullName: string;

  @IsString()
  rut: string;

  @IsDateString()
  birthDate: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  treatingPsychiatrist?: string;

  @IsOptional()
  @IsString()
  treatingDoctor?: string;
};
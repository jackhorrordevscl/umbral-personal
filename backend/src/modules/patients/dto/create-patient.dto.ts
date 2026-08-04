import {
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  ValidateIf,
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

  // @IsOptional() por sí solo solo exime undefined/null, no "" -- el
  // frontend siempre manda "" (nunca undefined) cuando el campo queda
  // vacío, así que sin @ValidateIf @IsEmail() rechazaba la creación con
  // email en blanco (issue #49).
  @IsOptional()
  @ValidateIf((o: CreatePatientDto) => o.email !== '')
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
}

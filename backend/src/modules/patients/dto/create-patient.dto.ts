import {
  IsInt,
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  Min,
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

  // sdd/online-payment-integration PR 1: monto de sesión por defecto que
  // PaymentsService.ensureCharge snapshotea al crear un cargo (design.md
  // "Charge Amount Resolution and Snapshot") -- opcional, un paciente sin
  // este campo nunca genera cargo automático.
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultSessionAmount?: number;
}

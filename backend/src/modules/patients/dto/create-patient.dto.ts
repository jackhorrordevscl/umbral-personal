import {
  IsInt,
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @MaxLength(200)
  fullName: string;

  @IsString()
  rut: string;

  @IsDateString()
  birthDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // @IsOptional() por sí solo solo exime undefined/null, no "" -- el
  // frontend siempre manda "" (nunca undefined) cuando el campo queda
  // vacío, así que sin @ValidateIf @IsEmail() rechazaba la creación con
  // email en blanco (issue #49).
  @IsOptional()
  @ValidateIf((o: CreatePatientDto) => o.email !== '')
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  treatingPsychiatrist?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
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

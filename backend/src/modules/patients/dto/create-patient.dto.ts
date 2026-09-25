import {
  IsInt,
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  MaxLength,
  Min,
  ValidateIf,
  Matches,
} from 'class-validator';

// Issue #196: solo valida la forma (con o sin puntos, guion obligatorio, igual
// que lo que persiste normalizeRut), no el dígito verificador.
const RUT_FORMAT = /^(\d{1,2}(\.\d{3}){2}|\d{7,8})-[\dkK]$/;

export class CreatePatientDto {
  @IsString()
  @MaxLength(200)
  fullName: string;

  @IsString()
  @Matches(RUT_FORMAT, {
    message: 'El RUT debe tener formato chileno, ej: 12345678-9 o 12.345.678-9',
  })
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

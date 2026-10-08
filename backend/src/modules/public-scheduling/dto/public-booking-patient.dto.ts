import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { PersonName } from '../../../common/validators/person-name.decorator';
import { IsRutFormat } from '../../../common/validators/is-rut.decorator';
import { IsStrictDateString } from '../../../common/validators/is-strict-date-string.decorator';
import { IsNotFutureDate } from '../../../common/validators/is-not-future-date.decorator';
import type { PublicBookingPatientInput } from '../../patients/patients.service';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.7, design.md "Identity
// resolution gotchas"): formulario público REDUCIDO -- a diferencia de
// CreatePatientDto (patients/dto), excluye a propósito
// defaultSessionAmount (monto de sesión por defecto, un dato de facturación
// que el terapeuta configura después) y no incluye ningún campo de
// documentos/consentimientos legales (esos flujos requieren sesión). email
// es OBLIGATORIO acá (a diferencia de CreatePatientDto, donde es opcional):
// es la clave de resolución de identidad para la reserva pública
// (PatientsService.resolveForPublicBooking).
//
// Cumple PublicBookingPatientInput por FORMA (structural typing de
// TypeScript), sin que PatientsModule importe nada de public-scheduling --
// design.md "no cycle".
export class PublicBookingPatientDto implements PublicBookingPatientInput {
  // Issue #299: MaxLength alineado con CreatePatientDto -- este endpoint es
  // anónimo, sin límites un request podría persistir strings arbitrarios.
  @PersonName(200)
  fullName: string;

  // Issue #289: solo la forma. El dígito verificador lo exige
  // PatientsService.resolveForPublicBooking únicamente al crear un paciente
  // nuevo, para no bloquear a quien ya tiene una ficha con un DV inválido.
  @IsRutFormat()
  rut: string;

  @IsStrictDateString()
  @IsNotFutureDate()
  birthDate: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

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
}

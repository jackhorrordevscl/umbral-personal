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
// es la clave de resolución de identidad de un ADULTO en la reserva pública
// (PatientsService.resolveForPublicBooking, que lo exige para adultos); un
// menor se identifica por RUT + RUT de su representante.
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

  // Optional here so a minor without an email of their own can be booked; the
  // service requires it for adults (decided from birthDate, not a client flag).
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

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

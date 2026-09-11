import { IsDateString, IsEmail, IsOptional, IsString } from 'class-validator';
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
  @IsString()
  fullName: string;

  @IsString()
  rut: string;

  @IsDateString()
  birthDate: string;

  @IsEmail()
  email: string;

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

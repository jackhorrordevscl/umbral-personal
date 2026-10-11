import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GuardianRelationship } from '@prisma/client';
import { PersonName } from '../../../common/validators/person-name.decorator';
import { IsRutFormat } from '../../../common/validators/is-rut.decorator';
import type { PublicBookingGuardianInput } from '../../patients/patients.service';

// Legal guardian submitted with a public booking for a minor. Only the RUT
// shape is validated here; PatientsService.resolveForPublicBooking checks the
// check digit and answers with the uniform 409 (same criterion as the patient
// RUT, issue #289). The email is required: it is the payment and
// communications contact for the minor's booking.
//
// Satisfies PublicBookingGuardianInput structurally, without PatientsModule
// importing anything from public-scheduling ("no cycle").
export class PublicBookingGuardianDto implements PublicBookingGuardianInput {
  @PersonName(200)
  fullName: string;

  @IsRutFormat()
  rut: string;

  @IsEnum(GuardianRelationship, {
    message: 'Relación con el paciente inválida',
  })
  relationship: GuardianRelationship;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

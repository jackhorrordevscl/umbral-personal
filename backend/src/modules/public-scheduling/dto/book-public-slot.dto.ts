import { Type } from 'class-transformer';
import { IsDateString, IsOptional, ValidateNested } from 'class-validator';
import { PublicBookingPatientDto } from './public-booking-patient.dto';
import { PublicBookingOriginDto } from './public-booking-origin.dto';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.7): body de
// POST .../availability/book -- slotStart debe ser uno de los `start`
// devueltos por GET .../availability (mismo formato ISO instant que
// AvailableSlot.start en availability.service.ts). patient anidado en vez de
// aplanado: separa claramente "qué slot" de "quién reserva", y
// PublicScheduleThrottlerGuard lee patient.email para el tracker
// (getPublicScheduleTracker).
export class BookPublicSlotDto {
  @IsDateString()
  slotStart: string;

  @ValidateNested()
  @Type(() => PublicBookingPatientDto)
  patient: PublicBookingPatientDto;

  // issue #157: origen de adquisición (referrer + utm_source), opcional --
  // ausente en clientes viejos o cuando el navegador no expone referrer.
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicBookingOriginDto)
  origin?: PublicBookingOriginDto;
}

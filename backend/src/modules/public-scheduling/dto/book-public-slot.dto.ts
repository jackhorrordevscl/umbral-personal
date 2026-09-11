import { Type } from 'class-transformer';
import { IsDateString, ValidateNested } from 'class-validator';
import { PublicBookingPatientDto } from './public-booking-patient.dto';

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
}

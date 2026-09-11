import { IsInt, Max, Min } from 'class-validator';
import { IsAfter } from '../../../common/validators/is-after.validator';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.5, design.md Decision 5
// "Wall-clock storage"): un entry de la grilla semanal -- dayOfWeek 1..7
// (ISO, lunes..domingo) + startMinute/endMinute desde medianoche hora Chile.
// Mismos campos que TherapistAvailability (schema.prisma).
export class ScheduleEntryDto {
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  @IsAfter('startMinute', {
    message: 'endMinute debe ser mayor que startMinute',
  })
  endMinute: number;
}

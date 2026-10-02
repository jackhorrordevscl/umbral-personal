import { Type } from 'class-transformer';
import { IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { MAX_SESSION_MINUTES } from '../../calendar-integration/calendar-integration.constants';
import { ScheduleEntryDto } from './schedule-entry.dto';

// sdd/patient-self-scheduling PR 2 (tasks.md 2.4/2.5, design.md Decision 8
// "Duration ownership"): body de `PUT /availability/schedule` -- guarda la
// grilla y sessionDurationMinutes atómicamente (un grid guardado contra una
// duración vieja quedaría incoherente).
export class ScheduleUpdateDto {
  @IsInt()
  @Min(1)
  @Max(MAX_SESSION_MINUTES)
  sessionDurationMinutes: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleEntryDto)
  entries: ScheduleEntryDto[];
}

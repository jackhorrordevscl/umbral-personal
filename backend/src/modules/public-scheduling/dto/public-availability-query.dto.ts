import { IsDateString, Matches } from 'class-validator';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.7): mismo criterio que
// ConsultationRangeQueryDto (consultations/dto) -- from/to deben venir como
// instantes ISO con offset explícito, no date-only, para no reintroducir la
// ambigüedad de zona horaria que ese DTO ya resolvió.
const ISO_INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export class PublicAvailabilityQueryDto {
  @IsDateString()
  @Matches(ISO_INSTANT_WITH_OFFSET, {
    message:
      '$property debe ser un instante ISO con hora y offset explícitos (ej. 2026-09-01T00:00:00-04:00), no solo una fecha',
  })
  from: string;

  @IsDateString()
  @Matches(ISO_INSTANT_WITH_OFFSET, {
    message:
      '$property debe ser un instante ISO con hora y offset explícitos (ej. 2026-09-01T00:00:00-04:00), no solo una fecha',
  })
  to: string;
}

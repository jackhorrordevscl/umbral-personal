import { IsDateString, Matches } from 'class-validator';

// design.md "Range query params are ISO instants with explicit offset,
// half-open": from/to deben venir como instantes ISO con offset explícito
// (ej. 2026-09-01T00:00:00-04:00), NOT date-only -- parseDate() no se
// reutiliza para este endpoint porque resuelve fechas sin hora en horario
// local del servidor. @IsDateString() por sí solo acepta también
// "YYYY-MM-DD" (válido en ISO8601), lo que reintroduciría la ambigüedad de
// zona horaria que este endpoint existe para evitar -- @Matches exige
// hora + offset/Z explícitos.
const ISO_INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export class ConsultationRangeQueryDto {
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

import { applyDecorators } from '@nestjs/common';
import { IsDateString, Matches } from 'class-validator';

// Issue #289: @IsDateString() acepta fechas imposibles como 2026-02-30, que
// luego dan Invalid Date (500) o se desplazan en silencio al mes siguiente.
// Esta variante exige el prefijo YYYY-MM-DD (descarta formatos ISO de semana
// u ordinales, que parseDate no sabe leer) y activa la validación estricta
// de calendario de validator.js (mes, día y hora existentes).
export function IsStrictDateString() {
  return applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}(T.*)?$/, {
      message: 'Debe ser una fecha ISO 8601 válida (YYYY-MM-DD)',
    }),
    IsDateString(
      { strict: true },
      {
        message:
          'Debe ser una fecha ISO 8601 válida que exista en el calendario',
      },
    ),
  );
}

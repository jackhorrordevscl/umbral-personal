import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsStrictDateString } from '../../../common/validators/is-strict-date-string.decorator';

// Sin ningún carácter de control (incluye saltos de línea): textos breves.
/* eslint-disable no-control-regex */
const NO_CONTROL_CHARS = /^[^\u0000-\u001F\u007F]*$/;
// Textos largos: se permiten \t, \n y \r, nada más de la familia de control.
const NO_CONTROL_CHARS_EXCEPT_WHITESPACE =
  /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;
/* eslint-enable no-control-regex */

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimEmptyToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

// Texto breve y opcional (nullable): "" se normaliza a null para poder limpiar
// el campo desde un PATCH.
export function OptionalShortText(max: number) {
  return applyDecorators(
    Transform(trimEmptyToNull),
    ValidateIf((_, value) => value !== undefined && value !== null),
    IsString(),
    MaxLength(max),
    Matches(NO_CONTROL_CHARS, {
      message: 'No puede contener caracteres de control',
    }),
  );
}

// Texto largo: si viene (distinto de undefined) debe ser string; null no vale.
export function LongText(max: number) {
  return applyDecorators(
    Transform(trim),
    ValidateIf((_, value) => value !== undefined),
    IsString(),
    MaxLength(max),
    Matches(NO_CONTROL_CHARS_EXCEPT_WHITESPACE, {
      message: 'No puede contener caracteres de control',
    }),
  );
}

// Texto largo y nullable ("" se normaliza a null), p. ej. el diagnóstico.
export function NullableLongText(max: number) {
  return applyDecorators(
    Transform(trimEmptyToNull),
    ValidateIf((_, value) => value !== undefined && value !== null),
    IsString(),
    MaxLength(max),
    Matches(NO_CONTROL_CHARS_EXCEPT_WHITESPACE, {
      message: 'No puede contener caracteres de control',
    }),
  );
}

// Fecha calendario pura (YYYY-MM-DD) válida en el calendario.
export function DateOnly() {
  return applyDecorators(
    ValidateIf((_, value) => value !== undefined),
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'Debe ser una fecha YYYY-MM-DD',
    }),
    IsStrictDateString(),
  );
}

export function SessionCountField() {
  return applyDecorators(
    ValidateIf((_, value) => value !== undefined),
    IsInt(),
    Min(0),
    Max(10000),
  );
}

// Límites de largo (caracteres) de los textos del informe.
export const DISCHARGE_LIMITS = {
  dropoutNote: 200,
  referralDestination: 120,
  consultReason: 2000,
  diagnosis: 1000,
  evolutionSummary: 5000,
  statusAtDischarge: 2000,
  recommendations: 3000,
} as const;

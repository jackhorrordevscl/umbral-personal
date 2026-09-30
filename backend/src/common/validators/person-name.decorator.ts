import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

// Issue #300: nombres de personas (terapeuta, paciente) terminan en emails,
// notificaciones y reportes. Se recortan espacios (el ValidationPipe global
// corre con transform: true) y se rechazan caracteres de control (\p{Cc}:
// saltos de línea, NUL, etc.) ademas de acotar la longitud.
export const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;

export function PersonName(maxLength: number) {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    MaxLength(maxLength),
    Matches(NO_CONTROL_CHARS, {
      message: 'No puede contener caracteres de control',
    }),
  );
}

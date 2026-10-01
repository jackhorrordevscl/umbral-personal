import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { normalizeEmail } from '../utils/normalize-email.util';

// Issue #303: el ValidationPipe global corre con transform: true, así que el
// valor ya llega recortado y en minúsculas al servicio (y a la validación de
// IsEmail, que por eso tampoco se confunde con espacios sobrantes).
export function NormalizedEmail() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeEmail(value) : value,
    ),
    IsEmail(),
  );
}

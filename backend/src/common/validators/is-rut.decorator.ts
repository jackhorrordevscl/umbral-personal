import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, ValidateBy } from 'class-validator';
import { isValidRut } from '../utils/rut.util';

// Issue #196: forma del RUT (con o sin puntos, guion obligatorio, igual que lo
// que persiste normalizeRut).
export const RUT_FORMAT = /^(\d{1,2}(\.\d{3}){2}|\d{7,8})-[\dkK]$/;

// Issue #289: además de la forma, comprueba el dígito verificador (módulo 11).
export function IsRut() {
  return applyDecorators(
    IsString(),
    Matches(RUT_FORMAT, {
      message:
        'El RUT debe tener formato chileno, ej: 12345678-9 o 12.345.678-9',
    }),
    ValidateBy({
      name: 'isRutCheckDigit',
      validator: {
        validate: (value: unknown) => isValidRut(value),
        defaultMessage: () => 'El dígito verificador del RUT no es válido',
      },
    }),
  );
}

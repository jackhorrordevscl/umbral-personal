import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, ValidateBy } from 'class-validator';
import { isValidRut } from '../utils/rut.util';

// Issue #196: forma del RUT (con o sin puntos, guion obligatorio, igual que lo
// que persiste normalizeRut).
export const RUT_FORMAT = /^(\d{1,2}(\.\d{3}){2}|\d{7,8})-[\dkK]$/;

// Solo la forma. La usa la edición de pacientes: una ficha existente puede
// tener un dígito verificador inválido (se aceptaba solo por formato), y no debe
// quedar imposible de editar; el servicio exige el DV únicamente si el RUT cambia.
export function IsRutFormat() {
  return applyDecorators(
    IsString(),
    Matches(RUT_FORMAT, {
      message:
        'El RUT debe tener formato chileno, ej: 12345678-9 o 12.345.678-9',
    }),
  );
}

// Issue #289: además de la forma, comprueba el dígito verificador (módulo 11).
export function IsRut() {
  return applyDecorators(
    IsRutFormat(),
    ValidateBy({
      name: 'isRutCheckDigit',
      validator: {
        validate: (value: unknown) => isValidRut(value),
        defaultMessage: () => 'El dígito verificador del RUT no es válido',
      },
    }),
  );
}

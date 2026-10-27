import { BadRequestException } from '@nestjs/common';
import { rejectNullFields } from './reject-null-fields.util';

describe('rejectNullFields', () => {
  it('lanza 400 con el nombre del campo cuando viene null', () => {
    expect(() =>
      rejectNullFields({ fullName: null, phone: '1' }, ['fullName']),
    ).toThrow(new BadRequestException('El campo fullName no puede ser null'));
  });

  it('permite campos ausentes, con valor o vacíos', () => {
    expect(() =>
      rejectNullFields({ phone: '' }, ['fullName', 'phone', 'birthDate']),
    ).not.toThrow();
    expect(() =>
      rejectNullFields({ fullName: 'Ana' }, ['fullName']),
    ).not.toThrow();
  });

  it('no revisa campos que no están en la lista (columnas nulables)', () => {
    expect(() =>
      rejectNullFields({ phone: null, email: null }, ['fullName']),
    ).not.toThrow();
  });
});

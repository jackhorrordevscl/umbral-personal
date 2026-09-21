import { maskEmail } from './mask-email.util';

describe('maskEmail', () => {
  it('mantiene el dominio y enmascara el local-part salvo el primer carácter', () => {
    expect(maskEmail('juan.perez@gmail.com')).toBe('j***@gmail.com');
  });

  it('funciona con local-part de un solo carácter', () => {
    expect(maskEmail('a@gmail.com')).toBe('a***@gmail.com');
  });

  it('devuelve un placeholder fijo si no hay "@"', () => {
    expect(maskEmail('no-es-un-email')).toBe('***');
  });

  it('devuelve un placeholder fijo si el local-part o el dominio están vacíos', () => {
    expect(maskEmail('@gmail.com')).toBe('***');
    expect(maskEmail('juan@')).toBe('***');
  });
});

import { describe, expect, it } from 'vitest';
import { initials, safeWebsite } from './public-profile';

describe('safeWebsite', () => {
  it('acepta http', () => {
    expect(safeWebsite('http://ejemplo.cl')).toEqual({
      href: 'http://ejemplo.cl/',
      label: 'ejemplo.cl',
    });
  });

  it('acepta https con path y lo incluye en la etiqueta', () => {
    expect(safeWebsite('https://ejemplo.cl/terapeuta/ana')).toEqual({
      href: 'https://ejemplo.cl/terapeuta/ana',
      label: 'ejemplo.cl/terapeuta/ana',
    });
  });

  it('rechaza javascript:', () => {
    expect(safeWebsite('javascript:alert(1)')).toBeNull();
  });

  it('rechaza data:', () => {
    expect(safeWebsite('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('devuelve null con string vacio', () => {
    expect(safeWebsite('')).toBeNull();
  });

  it('devuelve null con null y undefined', () => {
    expect(safeWebsite(null)).toBeNull();
    expect(safeWebsite(undefined)).toBeNull();
  });

  it('devuelve null con una URL invalida', () => {
    expect(safeWebsite('esto no es una url')).toBeNull();
  });
});

describe('initials', () => {
  it('usa las iniciales de las dos primeras palabras en mayuscula', () => {
    expect(initials('ana pérez')).toBe('AP');
  });

  it('ignora palabras sobrantes y espacios extra', () => {
    expect(initials('  María  José  Soto ')).toBe('MJ');
  });

  it('funciona con un solo nombre', () => {
    expect(initials('Ana')).toBe('A');
  });
});

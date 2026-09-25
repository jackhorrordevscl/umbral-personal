import { describe, expect, it } from 'vitest';
import { filterPatients } from './patient-search';

const patients = [
  { fullName: 'Ana Pérez', rut: '12.345.678-5' },
  { fullName: 'Luis Soto', rut: '9.876.543-3' },
];

describe('filterPatients', () => {
  it('devuelve todos con búsqueda vacía', () => {
    expect(filterPatients(patients, '')).toEqual(patients);
  });

  it('filtra por nombre sin distinguir mayúsculas', () => {
    expect(filterPatients(patients, 'ANA')).toEqual([patients[0]]);
  });

  it('filtra por RUT ignorando puntos y guion', () => {
    expect(filterPatients(patients, '9.876.543-3')).toEqual([patients[1]]);
    expect(filterPatients(patients, '98765')).toEqual([patients[1]]);
  });

  it('devuelve vacío si nada coincide', () => {
    expect(filterPatients(patients, 'zzz')).toEqual([]);
  });
});

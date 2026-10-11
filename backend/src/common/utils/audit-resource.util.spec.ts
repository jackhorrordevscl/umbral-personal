import { getResourceFromUrl } from './audit-resource.util';

describe('getResourceFromUrl', () => {
  it('clasifica las rutas de informes de alta como Discharge', () => {
    expect(getResourceFromUrl('/discharges/abc')).toBe('Discharge');
    expect(getResourceFromUrl('/discharges/abc/verify')).toBe('Discharge');
  });

  it('clasifica la lista de informes de un paciente como Discharge, no Patient', () => {
    expect(getResourceFromUrl('/patients/p1/discharges')).toBe('Discharge');
  });

  it('mantiene la clasificación de las demás rutas', () => {
    expect(getResourceFromUrl('/patients/p1')).toBe('Patient');
    expect(getResourceFromUrl('/consultations/c1')).toBe('Consultation');
    expect(getResourceFromUrl('/otra-cosa')).toBe('Unknown');
  });
});

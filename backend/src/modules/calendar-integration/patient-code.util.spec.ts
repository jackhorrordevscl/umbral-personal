import { patientLabel } from './patient-code.util';

// sdd/google-calendar-integration PR 2 (T6.1): patientLabel es la única
// función pública de este util -- design.md "Patient code = truncated
// domain-separated SHA-256 of patient.id, keyless". Estos tests cubren:
// determinismo, la convención de nombres chilena (2/3/4 tokens), tolerancia
// a diacríticos, y que el código (no las iniciales) sea estable aunque
// cambie fullName -- porque PatientsService.update puede mutar fullName
// después de que ya se publicaron eventos en Google con el código anterior.
describe('patientLabel', () => {
  it('es determinístico: la misma entrada produce siempre la misma salida', () => {
    const patient = { id: 'patient-fixed-uuid-1', fullName: 'Juan Soto' };

    const first = patientLabel(patient);
    const second = patientLabel(patient);

    expect(first).toBe(second);
  });

  it('nombre de 2 tokens usa "Nombre Apellido" -> iniciales de ambos', () => {
    const label = patientLabel({
      id: 'patient-2-tokens',
      fullName: 'Juan Soto',
    });

    expect(label.startsWith('JS-')).toBe(true);
  });

  it('nombre de 3 tokens usa "Nombre Apellido1 Apellido2" -> iniciales de token[0] y token[1]', () => {
    const label = patientLabel({
      id: 'patient-3-tokens',
      fullName: 'Juan Soto Rojas',
    });

    expect(label.startsWith('JS-')).toBe(true);
  });

  it('nombre de 4+ tokens usa "Nombre Nombre2 Apellido1 Apellido2" -> iniciales de token[0] y token[2]', () => {
    const label = patientLabel({
      id: 'patient-4-tokens',
      fullName: 'Juan Pablo Martínez Contreras',
    });

    expect(label.startsWith('JM-')).toBe(true);
  });

  it('tolera diacríticos: "Martínez" produce la misma inicial que "Martinez"', () => {
    const withAccent = patientLabel({
      id: 'patient-diacritics',
      fullName: 'Juan Pablo Martínez Contreras',
    });
    const withoutAccent = patientLabel({
      id: 'patient-diacritics',
      fullName: 'Juan Pablo Martinez Contreras',
    });

    expect(withAccent).toBe(withoutAccent);
  });

  it('el código es estable aunque cambie fullName (depende solo de patient.id)', () => {
    const before = patientLabel({
      id: 'patient-stable-id',
      fullName: 'Juan Soto',
    });
    const after = patientLabel({
      id: 'patient-stable-id',
      fullName: 'Juan Soto Rojas Actualizado',
    });

    const beforeCode = before.split('-')[1];
    const afterCode = after.split('-')[1];
    expect(beforeCode).toBe(afterCode);
  });

  it('el código son 6 caracteres Crockford base32 (sin I/L/O/U)', () => {
    const label = patientLabel({
      id: 'patient-code-format',
      fullName: 'Juan Soto',
    });
    const code = label.split('-')[1];

    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('dos ids distintos producen códigos distintos (no colisión trivial)', () => {
    const a = patientLabel({ id: 'patient-id-a', fullName: 'Juan Soto' });
    const b = patientLabel({ id: 'patient-id-b', fullName: 'Juan Soto' });

    expect(a.split('-')[1]).not.toBe(b.split('-')[1]);
  });
});

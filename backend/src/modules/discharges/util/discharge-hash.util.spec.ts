import {
  canonicalJson,
  computeDischargeHash,
  dischargeHashInputFromRow,
  hashesMatch,
  type DischargeHashInput,
  type DischargeHashRow,
} from './discharge-hash.util';

const baseRow: DischargeHashRow = {
  id: 'dis-1',
  patientId: 'pat-1',
  therapistId: 'th-1',
  groupId: 'dis-1',
  version: 1,
  source: 'GENERATED',
  closureReason: 'DISCHARGED',
  dropoutReason: null,
  dropoutNote: null,
  referralDestination: null,
  admissionDate: new Date('2026-03-02T00:00:00.000Z'),
  dischargeDate: new Date('2026-10-11T00:00:00.000Z'),
  sessionCount: 14,
  consultReason: 'Ansiedad',
  diagnosis: null,
  evolutionSummary: 'Evolución favorable',
  statusAtDischarge: 'Estable',
  recommendations: 'Control en 3 meses',
  signerName: 'Ana Pérez',
  signerRut: null,
  signerProfessionalRegistration: null,
  issuedAt: new Date('2026-10-11T15:30:00.000Z'),
};

function hashOf(overrides: Partial<DischargeHashRow> = {}): string {
  return computeDischargeHash(
    dischargeHashInputFromRow({ ...baseRow, ...overrides }),
  );
}

describe('canonicalJson', () => {
  it('ordena las claves recursivamente sin importar el orden de inserción', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } });
    const b = canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":[{"x":2,"y":1}],"d":2},"b":1}');
  });

  it('serializa las fechas en ISO UTC y trata undefined como null', () => {
    expect(
      canonicalJson({ d: new Date('2026-10-11T12:00:00.000Z'), u: undefined }),
    ).toBe('{"d":"2026-10-11T12:00:00.000Z","u":null}');
  });

  it('conserva el orden de los arreglos', () => {
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });
});

describe('computeDischargeHash', () => {
  it('es determinista y devuelve SHA-256 hexadecimal', () => {
    const first = hashOf();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOf()).toBe(first);
  });

  it('no depende del orden de las claves del objeto de entrada', () => {
    const input = dischargeHashInputFromRow(baseRow);
    const reordered: DischargeHashInput = {
      signer: input.signer,
      patientId: input.patientId,
      groupId: input.groupId,
      issuedAt: input.issuedAt,
      version: input.version,
      content: Object.fromEntries(
        Object.entries(input.content).reverse(),
      ) as DischargeHashInput['content'],
      dischargeId: input.dischargeId,
      therapistId: input.therapistId,
    };
    expect(computeDischargeHash(reordered)).toBe(computeDischargeHash(input));
  });

  const mutations: Array<[string, Partial<DischargeHashRow>]> = [
    ['id', { id: 'dis-2' }],
    ['patientId', { patientId: 'pat-2' }],
    ['therapistId', { therapistId: 'th-2' }],
    ['groupId', { groupId: 'otro' }],
    ['version', { version: 2 }],
    ['source', { source: 'UPLOADED' as never }],
    ['closureReason', { closureReason: 'REFERRED' as never }],
    ['dropoutReason', { dropoutReason: 'COST' as never }],
    ['dropoutNote', { dropoutNote: 'x' }],
    ['referralDestination', { referralDestination: 'Hospital' }],
    ['admissionDate', { admissionDate: new Date('2026-03-03T00:00:00.000Z') }],
    ['dischargeDate', { dischargeDate: new Date('2026-10-12T00:00:00.000Z') }],
    ['sessionCount', { sessionCount: 15 }],
    ['consultReason', { consultReason: 'Ansiedad.' }],
    ['diagnosis', { diagnosis: 'F41' }],
    ['evolutionSummary', { evolutionSummary: 'Evolución desfavorable' }],
    ['statusAtDischarge', { statusAtDischarge: 'Inestable' }],
    ['recommendations', { recommendations: 'Sin control' }],
    ['signerName', { signerName: 'Ana Perez' }],
    ['signerRut', { signerRut: '1-9' }],
    [
      'signerProfessionalRegistration',
      { signerProfessionalRegistration: 'REG-1' },
    ],
    ['issuedAt', { issuedAt: new Date('2026-10-11T15:30:00.001Z') }],
  ];

  it.each(mutations)('cambiar %s cambia el hash', (_name, override) => {
    expect(hashOf(override)).not.toBe(hashOf());
  });

  it('no confunde null con cadena vacía', () => {
    expect(hashOf({ diagnosis: null })).not.toBe(hashOf({ diagnosis: '' }));
  });

  it('rechaza una fila sin issuedAt', () => {
    expect(() =>
      dischargeHashInputFromRow({ ...baseRow, issuedAt: null }),
    ).toThrow();
  });
});

describe('hashesMatch', () => {
  it('compara en tiempo constante hashes iguales y distintos', () => {
    const h = hashOf();
    expect(hashesMatch(h, h)).toBe(true);
    expect(hashesMatch(h, hashOf({ sessionCount: 1 }))).toBe(false);
    expect(hashesMatch(h, 'corto')).toBe(false);
    expect(hashesMatch(h, null)).toBe(false);
  });
});

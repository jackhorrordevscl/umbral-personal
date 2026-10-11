import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDischargeDto } from './create-discharge.dto';
import { UpdateDischargeDto } from './update-discharge.dto';

async function errorsOf<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('CreateDischargeDto', () => {
  it('acepta un alta mínima', async () => {
    expect(
      await errorsOf(CreateDischargeDto, { closureReason: 'DISCHARGED' }),
    ).toEqual([]);
  });

  it('rechaza ACTIVE y valores fuera del enum', async () => {
    expect(
      await errorsOf(CreateDischargeDto, { closureReason: 'ACTIVE' }),
    ).toEqual(['closureReason']);
    expect(await errorsOf(CreateDischargeDto, { closureReason: 'X' })).toEqual([
      'closureReason',
    ]);
  });

  it('rechaza un dropoutReason fuera de la lista cerrada', async () => {
    expect(
      await errorsOf(CreateDischargeDto, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'INVENTED',
      }),
    ).toEqual(['dropoutReason']);
  });

  it('rechaza dropoutNote de más de 200 caracteres y con caracteres de control', async () => {
    const base = { closureReason: 'DROPPED_OUT', dropoutReason: 'OTHER' };
    expect(
      await errorsOf(CreateDischargeDto, {
        ...base,
        dropoutNote: 'a'.repeat(201),
      }),
    ).toEqual(['dropoutNote']);
    expect(
      await errorsOf(CreateDischargeDto, { ...base, dropoutNote: 'a\u0000b' }),
    ).toEqual(['dropoutNote']);
    expect(
      await errorsOf(CreateDischargeDto, { ...base, dropoutNote: 'a\nb' }),
    ).toEqual(['dropoutNote']);
    expect(
      await errorsOf(CreateDischargeDto, {
        ...base,
        dropoutNote: 'a'.repeat(200),
      }),
    ).toEqual([]);
  });

  it('aplica trim antes de medir el tope', async () => {
    expect(
      await errorsOf(CreateDischargeDto, {
        closureReason: 'DROPPED_OUT',
        dropoutReason: 'OTHER',
        dropoutNote: `  ${'a'.repeat(200)}  `,
      }),
    ).toEqual([]);
  });

  it('limita referralDestination a 120 caracteres', async () => {
    expect(
      await errorsOf(CreateDischargeDto, {
        closureReason: 'REFERRED',
        referralDestination: 'a'.repeat(121),
      }),
    ).toEqual(['referralDestination']);
  });

  it.each([
    'status',
    'contentHash',
    'issuedAt',
    'therapistId',
    'correctsId',
    'groupId',
    'signerName',
    'signerRut',
    'version',
    'patientId',
  ])('rechaza mass assignment de %s', async (field) => {
    expect(
      await errorsOf(CreateDischargeDto, {
        closureReason: 'DISCHARGED',
        [field]: 'x',
      }),
    ).toEqual([field]);
  });
});

describe('UpdateDischargeDto', () => {
  it('acepta un cuerpo vacío y campos parciales', async () => {
    expect(await errorsOf(UpdateDischargeDto, {})).toEqual([]);
    expect(
      await errorsOf(UpdateDischargeDto, {
        evolutionSummary: 'Buena evolución',
        sessionCount: 12,
        dischargeDate: '2026-10-11',
        dropoutReason: null,
      }),
    ).toEqual([]);
  });

  it('permite saltos de línea en textos largos pero no otros caracteres de control', async () => {
    expect(
      await errorsOf(UpdateDischargeDto, { recommendations: 'a\n\nb\tc' }),
    ).toEqual([]);
    expect(
      await errorsOf(UpdateDischargeDto, { recommendations: 'a\u0007b' }),
    ).toEqual(['recommendations']);
  });

  it('aplica topes a los textos largos', async () => {
    expect(
      await errorsOf(UpdateDischargeDto, {
        evolutionSummary: 'a'.repeat(5001),
      }),
    ).toEqual(['evolutionSummary']);
    expect(
      await errorsOf(UpdateDischargeDto, { consultReason: 'a'.repeat(2001) }),
    ).toEqual(['consultReason']);
  });

  it('valida fechas estrictas YYYY-MM-DD y sessionCount entero acotado', async () => {
    expect(
      await errorsOf(UpdateDischargeDto, { dischargeDate: '2026-02-30' }),
    ).toEqual(['dischargeDate']);
    expect(
      await errorsOf(UpdateDischargeDto, {
        admissionDate: '2026-02-01T00:00:00Z',
      }),
    ).toEqual(['admissionDate']);
    expect(await errorsOf(UpdateDischargeDto, { sessionCount: -1 })).toEqual([
      'sessionCount',
    ]);
    expect(await errorsOf(UpdateDischargeDto, { sessionCount: 1.5 })).toEqual([
      'sessionCount',
    ]);
  });

  it('rechaza null en campos obligatorios de texto', async () => {
    expect(await errorsOf(UpdateDischargeDto, { consultReason: null })).toEqual(
      ['consultReason'],
    );
  });

  it('rechaza ACTIVE y mass assignment', async () => {
    expect(
      await errorsOf(UpdateDischargeDto, { closureReason: 'ACTIVE' }),
    ).toEqual(['closureReason']);
    expect(await errorsOf(UpdateDischargeDto, { status: 'ISSUED' })).toEqual([
      'status',
    ]);
  });
});

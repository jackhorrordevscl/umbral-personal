import {
  buildSignupPath,
  parseArgs,
  upsertPromoCode,
} from '../../../scripts/create-promo-code';
import { hashInvitationCode } from '../auth/invitation-code.util';

const NOW = new Date('2026-11-05T12:00:00.000Z');

describe('create-promo-code parseArgs', () => {
  it('aplica los valores del issue #611 por defecto: 30 días de prueba, 30 canjes, 60 días de vigencia', () => {
    expect(parseArgs(['UMBRAL-FLYER', '--channel', 'flyer'], NOW)).toEqual({
      code: 'UMBRAL-FLYER',
      rawCode: 'UMBRAL-FLYER',
      channel: 'flyer',
      trialDays: 30,
      maxRedemptions: 30,
      expiresAt: new Date('2027-01-04T12:00:00.000Z'),
    });
  });

  it('respeta --max, --trial-days y --valid-days', () => {
    expect(
      parseArgs(
        [
          'UMBRAL-INSTAGRAM',
          '--channel',
          'instagram',
          '--max',
          '20',
          '--trial-days',
          '15',
          '--valid-days',
          '10',
        ],
        NOW,
      ),
    ).toEqual({
      code: 'UMBRAL-INSTAGRAM',
      rawCode: 'UMBRAL-INSTAGRAM',
      channel: 'instagram',
      trialDays: 15,
      maxRedemptions: 20,
      expiresAt: new Date('2026-11-15T12:00:00.000Z'),
    });
  });

  it('normaliza el código como el registro (issue #633): recorta espacios y lo pasa a mayúsculas, y conserva el original', () => {
    const args = parseArgs([' Umbral-Flyer ', '--channel', 'flyer'], NOW);
    expect(args.code).toBe('UMBRAL-FLYER');
    expect(args.rawCode).toBe('Umbral-Flyer');
  });

  it.each([
    [[]],
    [['UMBRAL-FLYER']],
    [['UMBRAL-FLYER', '--channel']],
    [['UMBRAL-FLYER', '--channel', ' ']],
    [['ab', '--channel', 'flyer']],
    [['CODIGO CON ESPACIO', '--channel', 'flyer']],
    [['CÓDIGO', '--channel', 'flyer']],
    [['UMBRAL-FLYER', '--channel', 'flyer', '--max', '0']],
    [['UMBRAL-FLYER', '--channel', 'flyer', '--max', 'abc']],
    [['UMBRAL-FLYER', '--channel', 'flyer', '--trial-days', '-1']],
    [['UMBRAL-FLYER', '--channel', 'flyer', '--valid-days', '0']],
  ])('rechaza %j', (argv) => {
    expect(() => parseArgs(argv, NOW)).toThrow();
  });
});

describe('create-promo-code buildSignupPath', () => {
  it('arma la ruta de registro con el código precargado', () => {
    expect(buildSignupPath('UMBRAL-FLYER')).toBe('/signup?promo=UMBRAL-FLYER');
  });
});

describe('create-promo-code upsertPromoCode (issue #633)', () => {
  const args = parseArgs(['Umbral-Flyer', '--channel', 'flyer'], NOW);
  const build = (rows: Record<string, { id: string }>) => ({
    findUnique: jest.fn(({ where }: { where: { codeHash: string } }) =>
      Promise.resolve(rows[where.codeHash] ?? null),
    ),
    update: jest.fn().mockResolvedValue({ id: 'updated' }),
    create: jest.fn().mockResolvedValue({ id: 'created' }),
  });
  const run = (promoCode: ReturnType<typeof build>) =>
    upsertPromoCode(
      { promoCode } as unknown as Parameters<typeof upsertPromoCode>[0],
      args,
    );

  it('crea el código normalizado si no existe ninguno', async () => {
    const promoCode = build({});
    await run(promoCode);
    expect(promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        codeHash: hashInvitationCode('UMBRAL-FLYER'),
      }) as unknown,
    });
    expect(promoCode.update).not.toHaveBeenCalled();
  });

  it('actualiza la fila creada antes de la normalización (conserva su conteo) en vez de crear otra', async () => {
    const promoCode = build({
      [hashInvitationCode('Umbral-Flyer')]: { id: 'legacy' },
    });
    await run(promoCode);
    expect(promoCode.update).toHaveBeenCalledWith({
      where: { id: 'legacy' },
      data: {
        channel: 'flyer',
        trialDays: 30,
        maxRedemptions: 30,
        expiresAt: args.expiresAt,
      },
    });
    expect(promoCode.create).not.toHaveBeenCalled();
  });

  it('si ya existe la fila normalizada la actualiza y no mira la original', async () => {
    const promoCode = build({
      [hashInvitationCode('UMBRAL-FLYER')]: { id: 'norm' },
      [hashInvitationCode('Umbral-Flyer')]: { id: 'legacy' },
    });
    await run(promoCode);
    expect(promoCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'norm' } }) as unknown,
    );
    expect(promoCode.findUnique).toHaveBeenCalledTimes(1);
  });
});

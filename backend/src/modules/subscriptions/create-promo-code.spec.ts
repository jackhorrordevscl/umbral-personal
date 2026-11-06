import { buildSignupPath, parseArgs } from '../../../scripts/create-promo-code';

const NOW = new Date('2026-11-05T12:00:00.000Z');

describe('create-promo-code parseArgs', () => {
  it('aplica los valores del issue #611 por defecto: 30 días de prueba, 30 canjes, 60 días de vigencia', () => {
    expect(parseArgs(['UMBRAL-FLYER', '--channel', 'flyer'], NOW)).toEqual({
      code: 'UMBRAL-FLYER',
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
      channel: 'instagram',
      trialDays: 15,
      maxRedemptions: 20,
      expiresAt: new Date('2026-11-15T12:00:00.000Z'),
    });
  });

  it('normaliza el código como el registro (issue #633): recorta espacios y lo pasa a mayúsculas', () => {
    expect(parseArgs([' Umbral-Flyer ', '--channel', 'flyer'], NOW).code).toBe(
      'UMBRAL-FLYER',
    );
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

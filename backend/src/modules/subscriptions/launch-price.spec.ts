import {
  DEFAULT_RENEWAL_PRICE_CLP,
  effectivePriceClp,
  launchPriceEnd,
} from './launch-price';

describe('launch-price (issue #611)', () => {
  const started = new Date('2026-11-10T12:00:00Z');

  it('el precio de lanzamiento dura 12 meses desde priceStartedAt', () => {
    expect(launchPriceEnd(started).toISOString()).toBe(
      '2027-11-10T12:00:00.000Z',
    );
  });

  it('un 29 de febrero termina el 28 de febrero del año siguiente, sin desbordar a marzo', () => {
    const leap = new Date('2028-02-29T12:00:00Z');
    expect(launchPriceEnd(leap).toISOString()).toBe('2029-02-28T12:00:00.000Z');
  });

  it('el precio post-lanzamiento por defecto es 12990', () => {
    expect(DEFAULT_RENEWAL_PRICE_CLP).toBe(12990);
  });

  it.each([
    ['recién creada', '2026-11-10T12:00:00Z', 6990],
    ['un instante antes de cumplir 12 meses', '2027-11-10T11:59:59Z', 6990],
    ['justo al cumplir 12 meses', '2027-11-10T12:00:00Z', 12990],
    ['pasados los 12 meses', '2028-03-01T00:00:00Z', 12990],
  ])('%s -> %s CLP', (_n, at, expected) => {
    expect(
      effectivePriceClp({
        priceClp: 6990,
        priceStartedAt: started,
        renewalPriceClp: 12990,
        now: new Date(at),
      }),
    ).toBe(expected);
  });

  it('nunca cobra menos que el precio congelado, ni siquiera pasados los 12 meses', () => {
    expect(
      effectivePriceClp({
        priceClp: 14990,
        priceStartedAt: started,
        renewalPriceClp: 12990,
        now: new Date('2028-01-01T00:00:00Z'),
      }),
    ).toBe(14990);
  });
});

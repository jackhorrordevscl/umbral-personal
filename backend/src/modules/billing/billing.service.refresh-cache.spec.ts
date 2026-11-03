import { BillingService } from './billing.service';

// Issue #611: el mapa de intervalos de /billing/refresh debe respetar su tope
// aunque todas las entradas sean recientes (la poda por antigüedad no alcanza).
describe('BillingService refresh interval map', () => {
  const MAX_ENTRIES = 1000;

  function build() {
    const service = new BillingService(
      null as never,
      null as never,
      null as never,
      null as never,
    );
    const remember = (userId: string, now: Date) =>
      (
        service as unknown as {
          rememberRefresh(userId: string, now: Date): void;
        }
      ).rememberRefresh(userId, now);
    const map = () =>
      (service as unknown as { lastRefreshAt: Map<string, number> })
        .lastRefreshAt;
    return { remember, map };
  }

  it('no supera el tope cuando todas las entradas son recientes y conserva la más nueva', () => {
    const { remember, map } = build();
    const now = new Date('2026-11-03T12:00:00Z');

    for (let i = 0; i < MAX_ENTRIES + 50; i++) remember(`user-${i}`, now);

    expect(map().size).toBeLessThanOrEqual(MAX_ENTRIES);
    expect(map().has(`user-${MAX_ENTRIES + 49}`)).toBe(true);
    expect(map().has('user-0')).toBe(false);
  });

  it('una cuenta que consulta de nuevo pasa a ser la más reciente y no se descarta primero', () => {
    const { remember, map } = build();
    const now = new Date('2026-11-03T12:00:00Z');

    for (let i = 0; i < MAX_ENTRIES; i++) remember(`user-${i}`, now);
    remember('user-0', now);
    remember('user-nuevo', now);

    expect(map().has('user-0')).toBe(true);
    expect(map().has('user-1')).toBe(false);
    expect(map().size).toBeLessThanOrEqual(MAX_ENTRIES);
  });
});

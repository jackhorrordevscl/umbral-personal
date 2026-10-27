import { extendPeriod, resolveAccessState } from './access-state';

const now = new Date('2026-11-10T12:00:00Z');
const days = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

describe('resolveAccessState', () => {
  it('es EXEMPT con una concesión permanente, aunque no haya período', () => {
    const r = resolveAccessState({
      now,
      currentPeriodEnd: null,
      grant: { expiresAt: null },
    });
    expect(r.state).toBe('EXEMPT');
  });

  it('es EXEMPT con una concesión temporal vigente', () => {
    const r = resolveAccessState({
      now,
      currentPeriodEnd: null,
      grant: { expiresAt: days(5) },
    });
    expect(r).toEqual({ state: 'EXEMPT', periodEnd: days(5), graceEnd: null });
  });

  it('una concesión vencida pasa al flujo normal de cobro', () => {
    const r = resolveAccessState({
      now,
      currentPeriodEnd: days(3),
      grant: { expiresAt: days(-1) },
    });
    expect(r.state).toBe('ACTIVE');
  });

  it('es ACTIVE con el período vigente', () => {
    const r = resolveAccessState({
      now,
      currentPeriodEnd: days(3),
      grant: null,
    });
    expect(r).toEqual({ state: 'ACTIVE', periodEnd: days(3), graceEnd: null });
  });

  it('pasa a GRACE al vencer el período y dura 7 días', () => {
    const r = resolveAccessState({
      now,
      currentPeriodEnd: days(-1),
      grant: null,
    });
    expect(r).toEqual({
      state: 'GRACE',
      periodEnd: days(-1),
      graceEnd: days(6),
    });
  });

  it('vencer justo ahora ya es GRACE (el período es exclusivo)', () => {
    const r = resolveAccessState({ now, currentPeriodEnd: now, grant: null });
    expect(r.state).toBe('GRACE');
  });

  it('pasa a READ_ONLY al terminar la gracia', () => {
    expect(
      resolveAccessState({ now, currentPeriodEnd: days(-7), grant: null })
        .state,
    ).toBe('READ_ONLY');
    expect(
      resolveAccessState({ now, currentPeriodEnd: days(-30), grant: null })
        .state,
    ).toBe('READ_ONLY');
  });

  it('sin período ni concesión es READ_ONLY', () => {
    expect(
      resolveAccessState({ now, currentPeriodEnd: null, grant: null }),
    ).toEqual({
      state: 'READ_ONLY',
      periodEnd: null,
      graceEnd: null,
    });
  });
});

describe('extendPeriod', () => {
  it('suma desde ahora si no hay período o ya venció', () => {
    expect(extendPeriod(now, null, 30)).toEqual(days(30));
    expect(extendPeriod(now, days(-10), 30)).toEqual(days(30));
  });

  it('suma desde el vencimiento si aún no vence (no pierde días)', () => {
    expect(extendPeriod(now, days(5), 30)).toEqual(days(35));
  });
});

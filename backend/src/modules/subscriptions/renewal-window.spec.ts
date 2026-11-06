import { isRenewalOpen, renewalOpensAt } from './renewal-window';

const DAY_MS = 24 * 60 * 60 * 1000;
// 18:00 de Santiago del 10 dic 2026 (UTC-3).
const END = new Date('2026-12-10T21:00:00.000Z');

describe('isRenewalOpen', () => {
  it('6 días calendario antes sigue cerrada', () => {
    expect(isRenewalOpen(new Date('2026-12-04T20:00:00.000Z'), END)).toBe(
      false,
    );
  });

  it('5 días calendario antes abre, aunque la hora sea anterior a la del vencimiento', () => {
    // 09:00 de Santiago del 5 dic: faltan 5 días calendario y 33 horas.
    expect(isRenewalOpen(new Date('2026-12-05T12:00:00.000Z'), END)).toBe(true);
  });

  it('en los días siguientes sigue abierta', () => {
    expect(isRenewalOpen(new Date(END.getTime() - DAY_MS), END)).toBe(true);
    expect(isRenewalOpen(new Date(END.getTime() - 60_000), END)).toBe(true);
  });
});

describe('renewalOpensAt', () => {
  it('es el vencimiento menos 5 días', () => {
    expect(renewalOpensAt(END)).toEqual(new Date('2026-12-05T21:00:00.000Z'));
  });
});

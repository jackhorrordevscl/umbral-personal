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
    // 09:00 de Santiago del 5 dic: faltan 5 días y 9 horas, pero son 5 días
    // calendario.
    expect(isRenewalOpen(new Date('2026-12-05T12:00:00.000Z'), END)).toBe(true);
  });

  it('en los días siguientes sigue abierta', () => {
    expect(isRenewalOpen(new Date(END.getTime() - DAY_MS), END)).toBe(true);
    expect(isRenewalOpen(new Date(END.getTime() - 60_000), END)).toBe(true);
  });
});

describe('renewalOpensAt', () => {
  it('es el inicio del día calendario de Santiago 5 días antes del vencimiento', () => {
    // 00:00 de Santiago del 5 dic 2026 (UTC-3).
    expect(renewalOpensAt(END)).toEqual(new Date('2026-12-05T03:00:00.000Z'));
  });

  it('coincide exactamente con el cambio de isRenewalOpen', () => {
    const opens = renewalOpensAt(END);
    expect(isRenewalOpen(opens, END)).toBe(true);
    expect(isRenewalOpen(new Date(opens.getTime() - 1), END)).toBe(false);
  });

  // Chile adelanta el reloj una hora a medianoche del sábado 5 al domingo 6 de
  // septiembre de 2026: restar 5×24 h daba el 2 de septiembre a las 23:30 locales,
  // un día antes del día real de apertura.
  it('no se corre un día al cruzar el cambio de horario', () => {
    // 00:30 de Santiago del 8 sep 2026 (UTC-3, ya en horario de verano).
    const end = new Date('2026-09-08T03:30:00.000Z');

    const opens = renewalOpensAt(end);

    // 00:00 de Santiago del 3 sep 2026 (UTC-4, aún sin horario de verano).
    expect(opens).toEqual(new Date('2026-09-03T04:00:00.000Z'));
    expect(isRenewalOpen(opens, end)).toBe(true);
    expect(isRenewalOpen(new Date(opens.getTime() - 1), end)).toBe(false);
  });
});

import { resolveDueReminders } from './reminder-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;
const END = new Date('2026-12-10T12:00:00.000Z');
const at = (daysBeforeEnd: number) =>
  new Date(END.getTime() - daysBeforeEnd * DAY_MS);

describe('resolveDueReminders', () => {
  it('no avisa antes del día calendario de los 5 días', () => {
    expect(resolveDueReminders(at(5.5), END)).toEqual({
      send: null,
      skip: [],
    });
  });

  it('avisa el de 5 días al entrar en la ventana', () => {
    expect(resolveDueReminders(at(5), END)).toEqual({ send: 5, skip: [] });
    expect(resolveDueReminders(at(3), END)).toEqual({ send: 5, skip: [] });
  });

  it('a 1 día envía el de 1 y reclama el de 5 sin enviarlo', () => {
    expect(resolveDueReminders(at(1), END)).toEqual({ send: 1, skip: [5] });
  });

  // Issue #633: el cron corre una vez al día (12:00 de Santiago) y "vence
  // mañana" es el día calendario siguiente, sin importar la hora del vencimiento.
  describe('por día calendario de Santiago (vencimiento a las 18:00 del 10 dic)', () => {
    const END_EVENING = new Date('2026-12-10T21:00:00.000Z');

    it('el cron del día 5 antes avisa el de 5 días', () => {
      expect(
        resolveDueReminders(new Date('2026-12-05T15:00:00.000Z'), END_EVENING),
      ).toEqual({ send: 5, skip: [] });
    });

    it('el cron del día 6 antes todavía no avisa', () => {
      expect(
        resolveDueReminders(new Date('2026-12-04T15:00:00.000Z'), END_EVENING),
      ).toEqual({ send: null, skip: [] });
    });

    it('el cron del día anterior avisa "1 día", no el de 5', () => {
      expect(
        resolveDueReminders(new Date('2026-12-09T15:00:00.000Z'), END_EVENING),
      ).toEqual({ send: 1, skip: [5] });
    });

    it('el de 0 solo sale una vez pasada la hora exacta del vencimiento', () => {
      expect(
        resolveDueReminders(new Date('2026-12-10T20:59:00.000Z'), END_EVENING),
      ).toEqual({ send: 1, skip: [5] });
      expect(resolveDueReminders(END_EVENING, END_EVENING)).toEqual({
        send: 0,
        skip: [5, 1],
      });
    });
  });

  it('al vencer envía el de 0 y reclama los anteriores', () => {
    expect(resolveDueReminders(END, END)).toEqual({ send: 0, skip: [5, 1] });
    expect(resolveDueReminders(new Date(END.getTime() + DAY_MS), END)).toEqual({
      send: 0,
      skip: [5, 1],
    });
  });
});

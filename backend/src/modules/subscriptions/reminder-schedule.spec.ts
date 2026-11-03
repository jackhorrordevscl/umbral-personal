import { resolveDueReminders } from './reminder-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;
const END = new Date('2026-12-10T12:00:00.000Z');
const at = (daysBeforeEnd: number) =>
  new Date(END.getTime() - daysBeforeEnd * DAY_MS);

describe('resolveDueReminders', () => {
  it('no avisa antes de los 5 días', () => {
    expect(resolveDueReminders(at(5.01), END)).toEqual({
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

  it('al vencer envía el de 0 y reclama los anteriores', () => {
    expect(resolveDueReminders(END, END)).toEqual({ send: 0, skip: [5, 1] });
    expect(resolveDueReminders(new Date(END.getTime() + DAY_MS), END)).toEqual({
      send: 0,
      skip: [5, 1],
    });
  });
});

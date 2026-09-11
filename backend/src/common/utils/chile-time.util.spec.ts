import {
  addDaysToDayKey,
  chileDayKeyFromInstant,
  chileWallTimeToInstant,
  dateOnlyDayKey,
  isoWeekdayFromDayKey,
} from './chile-time.util';

// sdd/patient-self-scheduling PR 2 (design.md "Slot grid" + tasks.md 2.1):
// backend mirror of frontend/src/utils/datetime.ts's Chile wall-clock
// helpers. The DST gap/repeat cases below are verified against Node's real
// tz database for Chile's actual 2026 transitions (found by scanning hourly
// offset changes with America/Santiago: fall-back GMT-3->GMT-4 at
// 2026-04-05T03:00:00Z, spring-forward GMT-4->GMT-3 at
// 2026-09-06T04:00:00Z) -- not hand-derived from the legal transition rule,
// so these tests describe actual runtime behavior, not an assumption.
describe('chile-time.util', () => {
  describe('isoWeekdayFromDayKey', () => {
    it('devuelve 1 (lunes) para un lunes conocido', () => {
      expect(isoWeekdayFromDayKey('2026-04-06')).toBe(1);
    });

    // Triangulación: día distinto -> weekday distinto, no hardcodeado.
    it('devuelve 7 (domingo) para un domingo conocido', () => {
      expect(isoWeekdayFromDayKey('2026-04-05')).toBe(7);
    });
  });

  describe('addDaysToDayKey', () => {
    it('avanza dentro del mismo mes', () => {
      expect(addDaysToDayKey('2026-04-10', 1)).toBe('2026-04-11');
    });

    // Triangulación: rollover de mes.
    it('hace rollover de mes', () => {
      expect(addDaysToDayKey('2026-01-31', 1)).toBe('2026-02-01');
    });

    // Triangulación: rollover de año.
    it('hace rollover de año', () => {
      expect(addDaysToDayKey('2026-12-31', 1)).toBe('2027-01-01');
    });
  });

  describe('dateOnlyDayKey', () => {
    it('extrae la fecha calendario de una columna @db.Date sin conversión de huso horario', () => {
      // Una columna @db.Date de Postgres llega como medianoche UTC -- convertir
      // por Santiago restaría horas y devolvería el día anterior (bug que este
      // helper evita a propósito, separado de chileDayKeyFromInstant).
      expect(dateOnlyDayKey(new Date('2026-01-01T00:00:00.000Z'))).toBe(
        '2026-01-01',
      );
    });
  });

  describe('chileDayKeyFromInstant', () => {
    it('devuelve el día calendario de Chile para un instante UTC', () => {
      // 2026-06-15T13:00:00Z en Chile (invierno, GMT-4) es 09:00 del mismo día.
      expect(chileDayKeyFromInstant(new Date('2026-06-15T13:00:00.000Z'))).toBe(
        '2026-06-15',
      );
    });

    // Triangulación: un instante cercano a medianoche UTC cruza el día en Chile.
    it('cruza al día anterior cuando el instante UTC cae de madrugada', () => {
      expect(chileDayKeyFromInstant(new Date('2026-06-15T02:00:00.000Z'))).toBe(
        '2026-06-14',
      );
    });
  });

  describe('chileWallTimeToInstant', () => {
    it('convierte una hora normal (sin DST en juego) al instante UTC correcto', () => {
      const instant = chileWallTimeToInstant('2026-06-15', 9 * 60);
      expect(instant).not.toBeNull();
      expect((instant as Date).toISOString()).toBe('2026-06-15T13:00:00.000Z');
    });

    // Triangulación: horario de verano (GMT-3) da un offset distinto.
    it('usa el offset de verano (GMT-3) cuando corresponde', () => {
      const instant = chileWallTimeToInstant('2026-01-15', 9 * 60);
      expect(instant).not.toBeNull();
      expect((instant as Date).toISOString()).toBe('2026-01-15T12:00:00.000Z');
    });

    it('hora repetida (fin de horario de verano): toma la PRIMERA ocurrencia', () => {
      // 2026-04-04 23:00 ocurre dos veces (GMT-3 a las 02:00Z, GMT-4 a las
      // 03:00Z del día siguiente) -- design.md exige la primera.
      const instant = chileWallTimeToInstant('2026-04-04', 23 * 60);
      expect(instant).not.toBeNull();
      expect((instant as Date).toISOString()).toBe('2026-04-05T02:00:00.000Z');
    });

    it('hora inexistente (inicio de horario de verano): devuelve null', () => {
      // 2026-09-06 00:00-00:59 nunca ocurre -- el reloj salta de 23:59 del
      // 05-09 directo a 01:00 del 06-09.
      expect(chileWallTimeToInstant('2026-09-06', 0)).toBeNull();
    });

    // Triangulación: la hora inmediatamente después del gap sí existe.
    it('la hora inmediatamente posterior al gap sí existe', () => {
      const instant = chileWallTimeToInstant('2026-09-06', 60);
      expect(instant).not.toBeNull();
      expect((instant as Date).toISOString()).toBe('2026-09-06T04:00:00.000Z');
    });
  });
});

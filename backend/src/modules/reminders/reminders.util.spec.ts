import { resolveDueOffsets } from './reminders.util';

// sdd/session-reminders PR 2 (T6.1/T6.2, T6.7/T6.8): due-ness es un predicado
// de instantes puros -- ver design.md "Due-ness as an instant predicate, not
// a time band". Estos tests no tocan Prisma ni mocks: son la lógica de
// negocio real, extraída a función pura (regla "Extract-Before-Mock" de
// strict-tdd.md) para poder cubrir todos los escenarios del spec sin 7+
// mocks de infraestructura.
describe('resolveDueOffsets', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('no marca nada due si la sesión está a más de 24h', () => {
    const sessionDate = new Date(now.getTime() + 24 * HOUR_MS + 1);

    expect(resolveDueOffsets(now, sessionDate)).toEqual({
      dispatch: null,
      skipped: [],
    });
  });

  it('marca H24 due exactamente en el límite de 24h', () => {
    const sessionDate = new Date(now.getTime() + 24 * HOUR_MS);

    expect(resolveDueOffsets(now, sessionDate)).toEqual({
      dispatch: 'H24',
      skipped: [],
    });
  });

  it('solo H24 está due cuando faltan entre 2h y 24h (H2 aún no vence)', () => {
    const sessionDate = new Date(now.getTime() + 10 * HOUR_MS);

    expect(resolveDueOffsets(now, sessionDate)).toEqual({
      dispatch: 'H24',
      skipped: [],
    });
  });

  it('cuando ambos offsets están due simultáneamente, despacha solo el más cercano (H2) y marca el otro (H24) como skipped', () => {
    // Sesión creada con 10 minutos de anticipación: tanto H24 como H2 ya
    // vencieron en el mismo tick -- design.md "When multiple offsets are
    // simultaneously due, only the nearest fires".
    const sessionDate = new Date(now.getTime() + 10 * 60 * 1000);

    expect(resolveDueOffsets(now, sessionDate)).toEqual({
      dispatch: 'H2',
      skipped: ['H24'],
    });
  });

  it('marca H2 due exactamente en el límite de 2h (H24 ya debió dispararse en un tick previo, así que aquí solo aparece H2 mismo si el predicado igual reporta ambos due)', () => {
    const sessionDate = new Date(now.getTime() + 2 * HOUR_MS);

    // A esta distancia exacta ambos offsets están matemáticamente due (2h
    // <= 24h y 2h <= 2h); el predicado puro no conoce el historial de
    // despachos -- por eso reporta el más cercano (H2) como dispatch y H24
    // como skipped. La capa de aplicación (RemindersService) es la que
    // absorbe vía P2002 el caso en que H24 ya fue despachado antes.
    expect(resolveDueOffsets(now, sessionDate)).toEqual({
      dispatch: 'H2',
      skipped: ['H24'],
    });
  });

  it('no marca nada due para una sesión que ya pasó', () => {
    const sessionDate = new Date(now.getTime() - 1);

    expect(resolveDueOffsets(now, sessionDate)).toEqual({
      dispatch: null,
      skipped: [],
    });
  });

  it('no marca nada due para una sesión que es exactamente "ahora"', () => {
    expect(resolveDueOffsets(now, now)).toEqual({
      dispatch: null,
      skipped: [],
    });
  });

  it('la aritmética de due-ness es en instantes UTC y no se ve afectada por un cruce de horario de verano', () => {
    // 2026-04-04 es la fecha real en que Chile retrocede el reloj (fin de
    // hora de verano) -- se elige a propósito para probar que el resultado
    // no depende de en qué lado de ese cambio de calendario local caiga
    // `now`, solo de la resta de milisegundos UTC.
    const dstNow = new Date('2026-04-04T02:00:00.000Z');
    const sessionDate = new Date(dstNow.getTime() + 24 * HOUR_MS);

    expect(resolveDueOffsets(dstNow, sessionDate)).toEqual({
      dispatch: 'H24',
      skipped: [],
    });
  });
});

import {
  BOOSTR_HOLIDAYS_URL,
  HOLIDAY_COUNTRY_CODE,
  BoostrHoliday,
  PublicHolidayUpsertClient,
  fetchBoostrHolidays,
  mapBoostrHolidayToUpsertData,
  seedHolidaysFromBoostr,
  upsertHolidays,
} from './holiday-seed.util';

// design.md "Holiday Data Source": Boostr.cl es la única llamada de red de
// este módulo, y solo la invoca backend/scripts/seed-holidays.ts al correrlo
// manualmente -- estos tests mockean `globalThis.fetch` con el mismo patrón
// que flow-gateway.client.spec.ts/google-calendar.client.spec.ts, así que
// ninguno de ellos toca la red real.
function mockFetchOnce(
  response: Partial<Response> & { ok: boolean; status: number },
  jsonBody: unknown = [],
) {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    json: jest.fn().mockResolvedValue(jsonBody),
    ...response,
  });
}

function buildFakePrisma(): PublicHolidayUpsertClient & {
  upsertCalls: Array<
    Parameters<PublicHolidayUpsertClient['publicHoliday']['upsert']>[0]
  >;
} {
  const upsertCalls: Array<
    Parameters<PublicHolidayUpsertClient['publicHoliday']['upsert']>[0]
  > = [];
  return {
    upsertCalls,
    publicHoliday: {
      upsert: jest.fn((args) => {
        upsertCalls.push(args);
        return Promise.resolve(args.create);
      }),
    },
  };
}

describe('holiday-seed.util', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('mapBoostrHolidayToUpsertData', () => {
    it('mapea title -> name, date -> Date UTC, y agrega countryCode fijo', () => {
      const holiday: BoostrHoliday = {
        date: '2026-01-01',
        title: 'Año Nuevo',
        type: 'Civil',
        inalienable: true,
      };

      const result = mapBoostrHolidayToUpsertData(holiday);

      expect(result).toEqual({
        date: new Date('2026-01-01T00:00:00.000Z'),
        name: 'Año Nuevo',
        countryCode: HOLIDAY_COUNTRY_CODE,
      });
    });

    // Triangulación: distinta fecha/título -> distinto resultado (no
    // hardcodeado).
    it('mapea una fecha y título distintos correctamente', () => {
      const holiday: BoostrHoliday = {
        date: '2026-09-18',
        title: 'Fiestas Patrias',
        type: 'Civil',
      };

      const result = mapBoostrHolidayToUpsertData(holiday);

      expect(result).toEqual({
        date: new Date('2026-09-18T00:00:00.000Z'),
        name: 'Fiestas Patrias',
        countryCode: 'CL',
      });
    });
  });

  describe('fetchBoostrHolidays', () => {
    it('pide BOOSTR_HOLIDAYS_URL y devuelve el array cuando la respuesta es un array plano', async () => {
      const holidays: BoostrHoliday[] = [
        { date: '2026-01-01', title: 'Año Nuevo' },
      ];
      mockFetchOnce({ ok: true, status: 200 }, holidays);

      const result = await fetchBoostrHolidays();

      expect(globalThis.fetch).toHaveBeenCalledWith(BOOSTR_HOLIDAYS_URL);
      expect(result).toEqual(holidays);
    });

    // Triangulación: Boostr envuelve la lista en { data: [...] } -- probar
    // ambas formas evita que la implementación quede hardcodeada a una sola.
    it('desenvuelve la lista cuando la respuesta viene como { data: [...] }', async () => {
      const holidays: BoostrHoliday[] = [
        { date: '2026-09-18', title: 'Fiestas Patrias' },
        { date: '2026-09-19', title: 'Día de las Glorias del Ejército' },
      ];
      mockFetchOnce({ ok: true, status: 200 }, { data: holidays });

      const result = await fetchBoostrHolidays();

      expect(result).toEqual(holidays);
    });

    it('lanza un error si Boostr responde con un status no exitoso', async () => {
      mockFetchOnce({ ok: false, status: 503 }, {});

      await expect(fetchBoostrHolidays()).rejects.toThrow(/503/);
    });
  });

  describe('upsertHolidays', () => {
    it('hace upsert de cada feriado con la clave compuesta (date, countryCode)', async () => {
      const prisma = buildFakePrisma();
      const holidays: BoostrHoliday[] = [
        { date: '2026-01-01', title: 'Año Nuevo' },
      ];

      const count = await upsertHolidays(prisma, holidays);

      expect(count).toBe(1);
      expect(prisma.upsertCalls).toEqual([
        {
          where: {
            date_countryCode: {
              date: new Date('2026-01-01T00:00:00.000Z'),
              countryCode: 'CL',
            },
          },
          update: { name: 'Año Nuevo' },
          create: {
            date: new Date('2026-01-01T00:00:00.000Z'),
            name: 'Año Nuevo',
            countryCode: 'CL',
          },
        },
      ]);
    });

    // Triangulación: más de un feriado -> más de un upsert, el conteo
    // devuelto refleja la cantidad real procesada.
    it('hace upsert de múltiples feriados y devuelve el conteo total', async () => {
      const prisma = buildFakePrisma();
      const holidays: BoostrHoliday[] = [
        { date: '2026-01-01', title: 'Año Nuevo' },
        { date: '2026-09-18', title: 'Fiestas Patrias' },
        { date: '2026-09-19', title: 'Día de las Glorias del Ejército' },
      ];

      const count = await upsertHolidays(prisma, holidays);

      expect(count).toBe(3);
      expect(prisma.upsertCalls).toHaveLength(3);
    });
  });

  describe('seedHolidaysFromBoostr', () => {
    it('pide los feriados a Boostr y los persiste, devolviendo el conteo', async () => {
      const holidays: BoostrHoliday[] = [
        { date: '2026-01-01', title: 'Año Nuevo' },
        { date: '2026-09-18', title: 'Fiestas Patrias' },
      ];
      mockFetchOnce({ ok: true, status: 200 }, holidays);
      const prisma = buildFakePrisma();

      const count = await seedHolidaysFromBoostr(prisma);

      expect(globalThis.fetch).toHaveBeenCalledWith(BOOSTR_HOLIDAYS_URL);
      expect(count).toBe(2);
      expect(prisma.upsertCalls).toHaveLength(2);
    });
  });
});

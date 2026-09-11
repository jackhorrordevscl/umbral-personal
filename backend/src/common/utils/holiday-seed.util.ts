// sdd/patient-self-scheduling PR 1 (design.md "Holiday Data Source" +
// "Chile Public Holidays as Implicit Blockouts"): Boostr.cl is the sole
// source for Chile's public holiday calendar -- no API key, `GET
// /holidays.json`. This module is invoked from exactly two places:
// backend/scripts/seed-holidays.ts (the manual, once-a-year run) and
// optionally from backend/prisma/seed.ts's local/dev bootstrap, gated
// behind SEED_HOLIDAYS=true. It is NEVER called at request time -- a
// Boostr outage or API change must never affect the public availability
// endpoint (AvailabilityService.computeSlots, PR 2).
export const BOOSTR_HOLIDAYS_URL = 'https://api.boostr.cl/holidays.json';
export const HOLIDAY_COUNTRY_CODE = 'CL';

export interface BoostrHoliday {
  date: string; // 'YYYY-MM-DD'
  title: string;
  type?: string;
  inalienable?: boolean;
  extra?: string | null;
}

export interface HolidayUpsertData {
  date: Date;
  name: string;
  countryCode: string;
}

// Subconjunto mínimo de PrismaClient que este módulo necesita -- permite a
// los tests pasar un fake sin depender de un PrismaClient real (mismo
// criterio que los mocks de Prisma en patients.service.spec.ts, ver
// design.md "Testing Strategy").
export interface PublicHolidayUpsertClient {
  publicHoliday: {
    upsert(args: {
      where: {
        date_countryCode: { date: Date; countryCode: string };
      };
      update: { name: string };
      create: HolidayUpsertData;
    }): Promise<unknown>;
  };
}

export function mapBoostrHolidayToUpsertData(
  holiday: BoostrHoliday,
): HolidayUpsertData {
  return {
    date: new Date(`${holiday.date}T00:00:00.000Z`),
    name: holiday.title,
    countryCode: HOLIDAY_COUNTRY_CODE,
  };
}

// Boostr's public endpoint has been observed to return either a bare array
// or `{ data: [...] }` -- unwrap defensively so a wrapper-shape change
// doesn't silently seed zero holidays.
export async function fetchBoostrHolidays(): Promise<BoostrHoliday[]> {
  const response = await fetch(BOOSTR_HOLIDAYS_URL);

  if (!response.ok) {
    throw new Error(
      `Boostr.cl respondió ${response.status} al pedir el calendario de feriados`,
    );
  }

  const body = (await response.json()) as
    | BoostrHoliday[]
    | { data?: BoostrHoliday[] };

  return Array.isArray(body) ? body : (body.data ?? []);
}

// Upsert keyed on (date, countryCode) -- design.md "Holiday Data Source":
// idempotent, safe to re-run every year without duplicating rows; a holiday
// whose title changed (e.g. renamed) gets its `name` updated in place.
export async function upsertHolidays(
  prisma: PublicHolidayUpsertClient,
  holidays: BoostrHoliday[],
): Promise<number> {
  let count = 0;
  for (const holiday of holidays) {
    const data = mapBoostrHolidayToUpsertData(holiday);
    await prisma.publicHoliday.upsert({
      where: {
        date_countryCode: { date: data.date, countryCode: data.countryCode },
      },
      update: { name: data.name },
      create: data,
    });
    count++;
  }
  return count;
}

export async function seedHolidaysFromBoostr(
  prisma: PublicHolidayUpsertClient,
): Promise<number> {
  const holidays = await fetchBoostrHolidays();
  return upsertHolidays(prisma, holidays);
}

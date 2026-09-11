// sdd/patient-self-scheduling PR 1 (design.md "Holiday Data Source"):
// standalone, MANUALLY-run script that fetches Chile's official public
// holiday calendar from Boostr.cl (https://api.boostr.cl/holidays.json, no
// API key) and upserts it into PublicHoliday, keyed on (date, countryCode).
//
// Run this once a year (Dec/Jan, when the following year's calendar is
// published) -- NEVER wired into `prisma migrate dev`/`deploy`, app boot, or
// any request path, so a Boostr outage or API change never affects the
// public availability endpoint (AvailabilityService.computeSlots, PR 2):
//
//   npx ts-node backend/scripts/seed-holidays.ts
//
// All upsert/mapping logic lives in ../src/common/utils/holiday-seed.util.ts
// (unit-tested there, with the Boostr fetch mocked -- see
// holiday-seed.util.spec.ts) so this file stays a thin, untested I/O
// wrapper, same split as backend/prisma/seed.ts.
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { seedHolidaysFromBoostr } from '../src/common/utils/holiday-seed.util';

export async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const count = await seedHolidaysFromBoostr(prisma);
    console.log(`✅ ${count} feriados sincronizados desde Boostr.cl`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from './seed-admin.defaults';
import { seedHolidaysFromBoostr } from '../src/common/utils/holiday-seed.util';

const prisma = new PrismaClient();

async function main() {
  // T7.3 (issue #32): configurable por env para que CI (y cualquier entorno
  // de test) pueda fijar credenciales explícitas sin depender de que el
  // literal hardcodeado acá coincida por casualidad con lo que esperan los
  // e2e-specs que loguean como este admin semilla (SEED_ADMIN_EMAIL/
  // SEED_ADMIN_PASSWORD). Sin env vars seteadas, se comporta igual que
  // antes.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;
  const passwordHash = await argon2.hash(adminPassword);

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      name: 'Profesional Umbral',
      role: 'PROFESSIONAL',
      mfaEnabled: false,
      mustChangePassword: true,
    },
  });

  console.log(`✅ Usuario creado: ${user.email}`);

  // sdd/patient-self-scheduling PR 1 (tasks.md 1.5, design.md "Holiday Data
  // Source"): opt-in y deshabilitado por default -- .github/workflows/ci.yml
  // corre `npm run seed` en cada build, y ese paso NO debe hacer una llamada
  // de red real a Boostr.cl en cada corrida de CI. Un desarrollador local que
  // quiere el calendario de feriados en su bootstrap lo pide a propósito:
  //   SEED_HOLIDAYS=true npm run seed
  // Envuelto en try/catch: una falla de Boostr (o de red) nunca debe tumbar
  // el resto del seed (el usuario admin ya se creó arriba).
  if (process.env.SEED_HOLIDAYS === 'true') {
    try {
      const count = await seedHolidaysFromBoostr(prisma);
      console.log(`✅ ${count} feriados sincronizados desde Boostr.cl`);
    } catch (e) {
      console.error(
        '⚠️  No se pudo sincronizar el calendario de feriados (Boostr.cl):',
        e,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

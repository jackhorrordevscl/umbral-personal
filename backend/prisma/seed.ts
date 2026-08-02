import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from './seed-admin.defaults';

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
      name: 'Administrador Umbral',
      role: 'ADMIN',
      mfaEnabled: false,
      mustChangePassword: true,
    },
  });

  console.log(`✅ Usuario creado: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import * as dotenv from 'dotenv';
dotenv.config();
import { NotificationType, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { MfaSecretCryptoService } from '../src/modules/auth/mfa-secret-crypto.service';

// Seed for the Playwright e2e (frontend/e2e/notification-detail.e2e.ts).
// Creates a PROFESSIONAL account with MFA already enabled plus the
// notification the test clicks on. Idempotent (upsert / find-or-create).
//
// Safety: this writes a user with a known password and a known TOTP secret,
// so it must never touch a real database. It refuses to run in production and
// only runs with an explicit opt-in:
//
//   E2E_SEED_CONFIRM=1 E2E_TEST_PASSWORD=... E2E_TEST_MFA_SECRET=... npm run seed:e2e
//
// Credentials come from env vars only (never printed). E2E_TEST_MFA_SECRET
// must be a base32 TOTP secret; it is encrypted with the app's own
// MfaSecretCryptoService (MFA_SECRET_ENCRYPTION_KEY keyring).

const DEFAULT_EMAIL = 'e2e-playwright@umbral.local';
const BASE32_RE = /^[A-Z2-7]{16,}=*$/i;
const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const NOTIFICATION_TITLE =
  'Es necesario revisar los documentos legales de los pacientes';
const NOTIFICATION_BODY =
  'Tuvimos un problema de almacenamiento y algunos documentos legales subidos ' +
  '(consentimientos, acuerdos de telemedicina, etc.) se perdieron antes del ' +
  '23/09. Ya está resuelto para que no vuelva a pasar, pero es necesario ' +
  'entrar a la ficha de cada paciente y volver a subir los que falten. ' +
  'Disculpa las molestias -- preferimos avisar antes de que lo notes por tu cuenta.';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`seed-e2e: missing required env var ${name}`);
  }
  return value;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-e2e: refusing to run with NODE_ENV=production');
  }
  if (process.env.E2E_SEED_CONFIRM !== '1') {
    throw new Error(
      'seed-e2e: refusing to run without E2E_SEED_CONFIRM=1 (explicit opt-in)',
    );
  }

  // dotenv may have loaded a .env that points at a real database: only run
  // against a local one (the CI service container is reached via localhost).
  const databaseHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname;
    } catch {
      return '';
    }
  })();
  if (!LOCAL_DATABASE_HOSTS.includes(databaseHost)) {
    throw new Error(
      'seed-e2e: refusing to run: DATABASE_URL must point to localhost/127.0.0.1',
    );
  }

  const email = (process.env.E2E_TEST_EMAIL || DEFAULT_EMAIL).toLowerCase();
  const password = requireEnv('E2E_TEST_PASSWORD');
  const mfaSecret = requireEnv('E2E_TEST_MFA_SECRET');
  if (!BASE32_RE.test(mfaSecret)) {
    throw new Error('seed-e2e: E2E_TEST_MFA_SECRET must be a base32 string');
  }

  // Reuse the app's own crypto so the stored value matches what login expects.
  const crypto = new MfaSecretCryptoService(
    new ConfigService(process.env as Record<string, unknown>),
  );
  crypto.onModuleInit();
  const storedMfaSecret = crypto.encrypt(mfaSecret.toUpperCase());

  const passwordHash = await argon2.hash(password);
  const prisma = new PrismaClient();
  try {
    const data = {
      passwordHash,
      mustChangePassword: false,
      mfaEnabled: true,
      mfaSecret: storedMfaSecret,
      lastUsedStep: null,
      emailVerified: true,
      deletedAt: null,
    };
    const user = await prisma.user.upsert({
      where: { email },
      update: data,
      create: { email, name: 'E2E Playwright', role: 'PROFESSIONAL', ...data },
    });

    const existing = await prisma.notification.findFirst({
      where: { userId: user.id, title: NOTIFICATION_TITLE },
      select: { id: true },
    });
    if (existing) {
      await prisma.notification.update({
        where: { id: existing.id },
        data: { readAt: null },
      });
    } else {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.PATIENT_DOCUMENT_REUPLOAD_REQUIRED,
          title: NOTIFICATION_TITLE,
          body: NOTIFICATION_BODY,
          linkPath: '/patients',
        },
      });
    }
    console.log(`E2E seed ready for ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

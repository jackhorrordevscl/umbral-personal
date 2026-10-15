import * as dotenv from 'dotenv';
dotenv.config();
import { NotificationType, PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { MfaSecretCryptoService } from '../src/modules/auth/mfa-secret-crypto.service';
import { PaymentCredentialCryptoService } from '../src/modules/payments/payment-credential-crypto.service';
import { normalizeRut } from '../src/common/utils/rut.util';

// Seed for the Playwright e2e (frontend/e2e/*.e2e.ts). Idempotent
// (upsert / find-or-create). It creates three independent accounts:
//  - a PROFESSIONAL with MFA already enabled plus the notification that
//    notification-detail.e2e.ts clicks on;
//  - a second PROFESSIONAL with a public profile, a slug and a weekly
//    schedule for public-booking.e2e.ts (no MFA, no usable password);
//  - a third PROFESSIONAL like the second one, plus a CONNECTED payment
//    account (fake Flow credentials) and a patient with a session fee, for
//    public-booking-payment.e2e.ts. The patient must already exist: a patient
//    created by the public booking never has a fee, so it is never charged.
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

// Public-booking therapist (frontend/e2e/public-booking.e2e.ts). The e2e opens
// /book/<slug>, so keep PUBLIC_BOOKING_SLUG in sync with that spec.
interface BookingTherapist {
  email: string;
  slug: string;
  name: string;
  bio: string;
}

const PUBLIC_BOOKING_THERAPIST: BookingTherapist = {
  email: 'e2e-public-booking@umbral.local',
  slug: 'e2e-reserva-publica',
  name: 'Terapeuta E2E Reserva',
  bio: 'Perfil de prueba para el e2e de la reserva pública.',
};
const PUBLIC_BOOKING_SPECIALTY = 'Psicología clínica E2E';

// Payment therapist (frontend/e2e/public-booking-payment.e2e.ts): keep the slug,
// the patient and the amount in sync with that spec. The Flow credentials are
// fake and must match the defaults of frontend/e2e/support/fake-flow-server.mjs.
const PAYMENT_BOOKING_THERAPIST: BookingTherapist = {
  email: 'e2e-payment-booking@umbral.local',
  slug: 'e2e-reserva-pago',
  name: 'Terapeuta E2E Pago',
  bio: 'Perfil de prueba para el e2e del pago de la reserva pública.',
};
const PAYMENT_PATIENT = {
  fullName: 'Paciente E2E Pago',
  rut: '11.111.111-1',
  birthDate: new Date('1988-03-20T00:00:00.000Z'),
  email: 'paciente-e2e-pago@example.com',
  defaultSessionAmount: 25000,
};
const FLOW_API_KEY = process.env.E2E_FLOW_API_KEY || 'e2e-flow-api-key';
const FLOW_SECRET_KEY =
  process.env.E2E_FLOW_SECRET_KEY || 'e2e-flow-secret-key';
const SESSION_MINUTES = 60;
// Every ISO weekday (1=Mon .. 7=Sun) from 09:00 to 18:00 Chile time. Slots
// come from this weekly rule, not from fixed dates, so whatever day the suite
// runs there are always bookable slots beyond the 24h lead time and inside the
// 60-day horizon (computeAvailableSlots). Seven days a week also makes weekends
// and the odd public holiday irrelevant.
const WEEKLY_START_MINUTE = 9 * 60;
const WEEKLY_END_MINUTE = 18 * 60;

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

async function seedPublicBookingTherapist(
  prisma: PrismaClient,
  { email, slug, name, bio }: BookingTherapist,
) {
  // Nobody logs in as this account: the hash is of random bytes that are
  // discarded, so there is no credential to leak. It is only used on create
  // (the update below never touches the password).
  const passwordHash = await argon2.hash(randomBytes(32).toString('hex'));
  const profile = {
    name,
    slug,
    specialty: PUBLIC_BOOKING_SPECIALTY,
    bio,
    sessionDurationMinutes: SESSION_MINUTES,
    mustChangePassword: false,
    mfaEnabled: false,
    emailVerified: true,
    deletedAt: null,
  };
  const therapist = await prisma.user.upsert({
    where: { email },
    update: profile,
    create: {
      email,
      role: 'PROFESSIONAL',
      passwordHash,
      ...profile,
    },
  });

  // Reset the schedule so the result does not depend on previous runs. This
  // therapist is exclusive to the e2e, so replacing its rules is safe.
  await prisma.$transaction([
    prisma.availabilityBlockout.deleteMany({
      where: { therapistId: therapist.id },
    }),
    prisma.therapistAvailability.deleteMany({
      where: { therapistId: therapist.id },
    }),
    prisma.therapistAvailability.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
        therapistId: therapist.id,
        dayOfWeek,
        startMinute: WEEKLY_START_MINUTE,
        endMinute: WEEKLY_END_MINUTE,
      })),
    }),
  ]);
  console.log(`E2E public booking therapist ready: /book/${slug}`);
  return therapist;
}

// Payment side of the payment e2e: a CONNECTED Flow account whose credentials
// are the fake ones, and a patient with a session fee already registered with
// the therapist (the public booking matches it by email + RUT). Credentials are
// encrypted with the app's own PaymentCredentialCryptoService, the same shape
// PaymentAccountService.connect() writes (credentialVersion 2).
async function seedPaymentAccountAndPatient(
  prisma: PrismaClient,
  therapistId: string,
) {
  const crypto = new PaymentCredentialCryptoService(
    new ConfigService(process.env as Record<string, unknown>),
  );
  crypto.onModuleInit();
  const credentialEncrypted = Uint8Array.from(
    crypto.encrypt(
      Buffer.from(
        JSON.stringify({ apiKey: FLOW_API_KEY, secretKey: FLOW_SECRET_KEY }),
        'utf-8',
      ),
    ),
  );
  const account = {
    provider: 'FLOW' as const,
    status: 'CONNECTED' as const,
    displayName: 'Flow E2E (simulado)',
    keyFingerprint: 'e2e-fake-flow',
    credentialVersion: 2,
    credentialEncrypted,
    connectedAt: new Date(),
    lastError: null,
  };
  await prisma.paymentAccount.upsert({
    where: { therapistId },
    update: account,
    create: { therapistId, ...account },
  });

  // No unique key to upsert on (the RUT index is partial and SQL-only), so
  // find-or-create by the normalized RUT within this therapist.
  const rut = normalizeRut(PAYMENT_PATIENT.rut);
  const patient = {
    fullName: PAYMENT_PATIENT.fullName,
    birthDate: PAYMENT_PATIENT.birthDate,
    email: PAYMENT_PATIENT.email,
    defaultSessionAmount: PAYMENT_PATIENT.defaultSessionAmount,
    isActive: true,
    deletedAt: null,
    treatmentStatus: 'ACTIVE' as const,
  };
  const existing = await prisma.patient.findFirst({
    where: { therapistId, rut },
    select: { id: true },
  });
  if (existing) {
    await prisma.patient.update({ where: { id: existing.id }, data: patient });
  } else {
    await prisma.patient.create({ data: { ...patient, rut, therapistId } });
  }
  console.log('E2E payment account and patient ready');
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

  const publicPrisma = new PrismaClient({ adapter: createPrismaAdapter() });
  try {
    await seedPublicBookingTherapist(publicPrisma, PUBLIC_BOOKING_THERAPIST);
    const paymentTherapist = await seedPublicBookingTherapist(
      publicPrisma,
      PAYMENT_BOOKING_THERAPIST,
    );
    await seedPaymentAccountAndPatient(publicPrisma, paymentTherapist.id);
  } finally {
    await publicPrisma.$disconnect();
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
  const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
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

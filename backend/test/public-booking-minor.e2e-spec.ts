import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { uniqueTestRut } from './support/unique-rut';
import {
  chileDayKeyFromInstant,
  chileWallTimeToInstant,
  isoWeekdayFromDayKey,
  addDaysToDayKey,
} from '../src/common/utils/chile-time.util';

// Same criterion as public-booking-checkout.e2e-spec.ts: the Monday is
// computed against the real run date, never a hardcoded day key.
function nextMondayDayKeyWithMargin(): string {
  let dayKey = chileDayKeyFromInstant(new Date());
  while (isoWeekdayFromDayKey(dayKey) !== 1) {
    dayKey = addDaysToDayKey(dayKey, 1);
  }
  return addDaysToDayKey(dayKey, 7);
}

// Birth dates relative to today, so the minor stays a minor and the adult
// stays an adult whenever the suite runs (no time bomb).
function birthDateYearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

/**
 * Minor public booking over the real AppModule (real Postgres). The server
 * decides minor-ness from patient.birthDate; a minor is identified by RUT
 * scoped to the therapist plus the RUT of one of their guardians, and the
 * first booking creates the patient and one guardian in the same transaction
 * as the consultation.
 */
describe('Public booking for a minor (e2e)', () => {
  const ORIGINAL_SCHEDULING_FLAG = process.env.PUBLIC_SCHEDULING_ENABLED;

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let therapistId: string;
  let minorPatientId: string;

  const runId = Date.now();
  const mondayDayKey = nextMondayDayKeyWithMargin();
  // 50-minute grid from 09:00: 09:00, 09:50, 10:40, 11:30.
  const firstSlot = chileWallTimeToInstant(mondayDayKey, 9 * 60) as Date;
  const secondSlot = chileWallTimeToInstant(mondayDayKey, 9 * 60 + 50) as Date;
  const thirdSlot = chileWallTimeToInstant(mondayDayKey, 10 * 60 + 40) as Date;

  const minorRut = uniqueTestRut();
  const guardianRut = uniqueTestRut();
  const minorPatient = {
    fullName: 'Paciente Menor E2E',
    rut: minorRut,
    birthDate: birthDateYearsAgo(12),
  };
  const guardian = {
    fullName: 'Representante Legal E2E',
    rut: guardianRut,
    relationship: 'MOTHER',
    email: `Representante.${runId}@Ejemplo.cl`,
  };

  const book = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/public/therapists/${therapistId}/availability/book`)
      .send(body);

  beforeAll(async () => {
    process.env.PUBLIC_SCHEDULING_ENABLED = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);

    const therapist = await prisma.user.create({
      data: {
        email: `public-booking-minor.${runId}@umbral.cl`,
        passwordHash: 'x',
        name: 'Minor Booking E2E Therapist',
      },
    });
    therapistId = therapist.id;

    await prisma.therapistAvailability.create({
      data: {
        therapistId,
        dayOfWeek: 1,
        startMinute: 9 * 60,
        endMinute: 13 * 60,
      },
    });
  }, 30000);

  afterAll(async () => {
    try {
      const patients = await prisma.patient.findMany({
        where: { therapistId },
        select: { id: true },
      });
      const patientIds = patients.map((p) => p.id);
      await prisma.payment.deleteMany({
        where: { patientId: { in: patientIds } },
      });
      await prisma.bookedSlot.deleteMany({ where: { therapistId } });
      await prisma.consultation.deleteMany({
        where: { patientId: { in: patientIds } },
      });
      await prisma.legalGuardian.deleteMany({
        where: { patientId: { in: patientIds } },
      });
      await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
      await prisma.therapistAvailability.deleteMany({
        where: { therapistId },
      });
      await prisma.user.update({
        where: { id: therapistId },
        data: { deletedAt: new Date() },
      });
    } finally {
      if (ORIGINAL_SCHEDULING_FLAG === undefined) {
        delete process.env.PUBLIC_SCHEDULING_ENABLED;
      } else {
        process.env.PUBLIC_SCHEDULING_ENABLED = ORIGINAL_SCHEDULING_FLAG;
      }
      await app.close();
    }
  });

  it('a minor without email is booked with a guardian: creates the patient and one paying guardian', async () => {
    const response = await book({
      slotStart: firstSlot.toISOString(),
      patient: minorPatient,
      guardian,
    }).expect(201);

    const body = response.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('patientId');
    const consultation = await prisma.consultation.findFirstOrThrow({
      where: { groupId: body.groupId as string },
      select: { patientId: true },
    });
    minorPatientId = consultation.patientId;

    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: minorPatientId },
      include: { guardians: true },
    });
    expect(patient.email).toBeNull();
    expect(patient.guardians).toHaveLength(1);
    expect(patient.guardians[0]).toMatchObject({
      rut: guardianRut,
      relationship: 'MOTHER',
      email: guardian.email.toLowerCase(),
      isPayer: true,
      receivesCommunications: true,
      canAccessReports: true,
      canConsent: true,
      custody: 'UNKNOWN',
      hasConflict: false,
    });
  });

  it('booking the same minor again with the same guardian RUT reuses the patient without new guardians', async () => {
    const response = await book({
      slotStart: secondSlot.toISOString(),
      patient: minorPatient,
      guardian: {
        ...guardian,
        fullName: 'Otro Nombre',
        email: 'otro@ejemplo.cl',
      },
    }).expect(201);

    const consultation = await prisma.consultation.findFirstOrThrow({
      where: { groupId: (response.body as { groupId: string }).groupId },
      select: { patientId: true },
    });
    expect(consultation.patientId).toBe(minorPatientId);
    const guardians = await prisma.legalGuardian.findMany({
      where: { patientId: minorPatientId },
    });
    expect(guardians).toHaveLength(1);
    expect(guardians[0].fullName).toBe('Representante Legal E2E');
  });

  it('the same minor with a different guardian RUT gets the uniform 409 and nothing is booked', async () => {
    const response = await book({
      slotStart: thirdSlot.toISOString(),
      patient: minorPatient,
      guardian: { ...guardian, rut: uniqueTestRut() },
    }).expect(409);

    expect(JSON.stringify(response.body)).toContain(
      'No fue posible procesar la reserva.',
    );
    const slot = await prisma.bookedSlot.findFirst({
      where: { therapistId, slotStart: thirdSlot },
    });
    expect(slot).toBeNull();
  });

  it('a minor without a guardian is rejected with 400', async () => {
    await book({
      slotStart: thirdSlot.toISOString(),
      patient: { ...minorPatient, rut: uniqueTestRut() },
    }).expect(400);
  });

  it('an adult with a guardian is rejected with 400', async () => {
    await book({
      slotStart: thirdSlot.toISOString(),
      patient: {
        fullName: 'Paciente Adulto E2E',
        rut: uniqueTestRut(),
        birthDate: birthDateYearsAgo(30),
        email: `adulto.${runId}@ejemplo.cl`,
      },
      guardian,
    }).expect(400);
  });

  it('an adult without email is rejected with 400', async () => {
    await book({
      slotStart: thirdSlot.toISOString(),
      patient: {
        fullName: 'Paciente Adulto E2E',
        rut: uniqueTestRut(),
        birthDate: birthDateYearsAgo(30),
      },
    }).expect(400);
  });
});

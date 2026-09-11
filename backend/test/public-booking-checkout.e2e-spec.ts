import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  chileDayKeyFromInstant,
  chileWallTimeToInstant,
  isoWeekdayFromDayKey,
  addDaysToDayKey,
} from '../src/common/utils/chile-time.util';

// Mismo criterio que calendar-busy-overlay.e2e-spec.ts (bug detectado en
// ese PR): computar el lunes futuro contra la fecha real de ejecución en
// vez de hardcodear un dayKey que eventualmente cae en el pasado.
function nextMondayDayKeyWithMargin(): string {
  let dayKey = chileDayKeyFromInstant(new Date());
  while (isoWeekdayFromDayKey(dayKey) !== 1) {
    dayKey = addDaysToDayKey(dayKey, 1);
  }
  return addDaysToDayKey(dayKey, 7); // una semana más de margen
}

/**
 * sdd/public-booking-payment-calendar PR 5a (tasks.md 5.1, 5.2, 5.6): e2e
 * sobre AppModule real (Postgres real, mismo criterio que
 * public-scheduling.e2e-spec.ts / calendar-busy-overlay.e2e-spec.ts).
 *
 * El terapeuta sembrado NO tiene GoogleCalendarConnection ni PaymentAccount
 * -- a propósito: Flow y Google están "no disponibles" en el sentido exacto
 * que exige spec.md ("Booking succeeds without a checkout URL when payment
 * is unavailable") y el criterio de éxito de proposal.md ("booking still
 * succeeds when Flow or Google is unavailable"). emitCalendarSync/
 * emitPaymentCharge siguen siendo fire-and-forget (consultations.service.ts)
 * y ninguno de los dos puede bloquear ni revertir la reserva.
 */
describe('Public booking checkout (e2e)', () => {
  const ORIGINAL_SCHEDULING_FLAG = process.env.PUBLIC_SCHEDULING_ENABLED;
  const ORIGINAL_CHECKOUT_FLAG =
    process.env.PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED;

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let therapistId: string;
  let groupId: string;
  let patientId: string;

  const runId = Date.now();
  const mondayDayKey = nextMondayDayKeyWithMargin();
  const slotStart = chileWallTimeToInstant(mondayDayKey, 9 * 60) as Date;

  beforeAll(async () => {
    process.env.PUBLIC_SCHEDULING_ENABLED = 'true';
    process.env.PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED = 'true';

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
        email: `public-booking-checkout.${runId}@umbral.cl`,
        passwordHash: 'x',
        name: 'Checkout E2E Therapist',
      },
    });
    therapistId = therapist.id;

    // Lunes 09:00-13:00 Chile, sesiones de 50 min -- mismo grid que
    // calendar-busy-overlay.e2e-spec.ts. Sin GoogleCalendarConnection, sin
    // PaymentAccount: ninguna de las dos integraciones externas está
    // configurada para este terapeuta.
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
      if (groupId) {
        await prisma.payment.deleteMany({ where: { groupId } });
        await prisma.bookedSlot.deleteMany({ where: { groupId } });
        await prisma.consultation.deleteMany({ where: { groupId } });
      }
      if (patientId) {
        await prisma.patient.deleteMany({ where: { id: patientId } });
      }
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
      if (ORIGINAL_CHECKOUT_FLAG === undefined) {
        delete process.env.PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED;
      } else {
        process.env.PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED =
          ORIGINAL_CHECKOUT_FLAG;
      }
      await app.close();
    }
  });

  it('la reserva pública se completa de punta a punta con Flow y Google no disponibles, y responde checkout NOT_APPLICABLE (paciente nuevo, sin defaultSessionAmount)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/public/therapists/${therapistId}/availability/book`)
      .send({
        slotStart: slotStart.toISOString(),
        patient: {
          fullName: 'Paciente Checkout E2E',
          rut: `${runId}-1`,
          birthDate: '1990-01-01',
          email: `paciente-checkout.${runId}@ejemplo.cl`,
        },
      })
      .expect(201);

    expect(response.body).toMatchObject({
      checkout: { status: 'NOT_APPLICABLE' },
    });

    const body = response.body as { groupId: string; patientId: string };
    expect(typeof body.groupId).toBe('string');

    groupId = body.groupId;
    patientId = body.patientId;
  });

  it('GET .../book/:groupId/checkout responde sin exigir Authorization (no 401) y, sin ningún Payment emitido todavía, expone solo { paymentUrl: null }', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/public/therapists/${therapistId}/availability/book/${groupId}/checkout`,
      )
      .expect(200);

    expect(response.status).not.toBe(401);
    expect(response.body).toEqual({ paymentUrl: null });
    expect(Object.keys(response.body as object)).toEqual(['paymentUrl']);
  });

  it('con un Payment ya emitido para ese groupId, el endpoint expone exactamente { paymentUrl, amount } -- nada más de la fila Payment (ni status, ni gatewayToken, ni datos del paciente)', async () => {
    await prisma.payment.create({
      data: {
        groupId,
        patientId,
        therapistId,
        amount: 30000,
        status: 'PENDING',
        dueDate: slotStart,
        paymentUrl: 'https://flow.cl/pay/e2e-checkout-token',
        gatewayToken: 'nunca-debe-salir-en-la-respuesta',
      },
    });

    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/public/therapists/${therapistId}/availability/book/${groupId}/checkout`,
      )
      .expect(200);

    expect(response.body).toEqual({
      paymentUrl: 'https://flow.cl/pay/e2e-checkout-token',
      amount: 30000,
    });
    expect(Object.keys(response.body as object).sort()).toEqual([
      'amount',
      'paymentUrl',
    ]);
  });
});

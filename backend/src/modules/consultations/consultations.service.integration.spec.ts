import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PatientsService } from '../patients/patients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GoogleTokenCryptoService } from '../calendar-integration/google-token-crypto.service';
import { CalendarSyncService } from '../calendar-integration/calendar-sync.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from '../calendar-integration/google-calendar.client';
import { ConsultationsService } from './consultations.service';
import { PaymentsService } from '../payments/payments.service';
import { UnconfiguredPaymentGatewayClient } from '../payments/payment-gateway.client';

// Los describe blocks preexistentes de este archivo (calendar/findByRange)
// no ejercitan PaymentsService -- se les inyecta una instancia con
// PAYMENTS_ENABLED="false" para que ensureCharge() sea un no-op inmediato y
// no requiera una PaymentAccount/defaultSessionAmount de fixture.
function buildDisabledPaymentsService(prisma: PrismaService): PaymentsService {
  const config = {
    get: (key: string) => (key === 'PAYMENTS_ENABLED' ? 'false' : undefined),
  } as unknown as ConfigService;
  return new PaymentsService(
    prisma,
    new UnconfiguredPaymentGatewayClient(),
    config,
  );
}

/**
 * sdd/google-calendar-integration PR 2 (T6.11/T6.12): Google Calendar
 * rechazando TODAS las llamadas (real Prisma, cliente de Google mockeado
 * forzado a rechazar) -- create()/correct() deben resolver igual de bien
 * que si Google nunca hubiera existido (spec.md "Non-Blocking Sync
 * Failures"). Requiere DATABASE_URL/DIRECT_URL apuntando a Postgres, mismo
 * patrón que reminders.service.integration.spec.ts.
 */
describe('ConsultationsService + CalendarSyncService (integration, Google client failing)', () => {
  let prisma: PrismaService;
  let consultationsService: ConsultationsService;
  let googleCalendarClient: {
    insertEvent: jest.Mock;
    patchEvent: jest.Mock;
    deleteEvent: jest.Mock;
  };
  const runId = Date.now();

  let therapistId: string;
  let patientId: string;

  function buildConfig(): ConfigService {
    const values: Record<string, string> = {
      FRONTEND_URL: 'https://app.umbral.cl',
      GOOGLE_CLIENT_ID: 'integration-test-client-id',
      GOOGLE_CLIENT_SECRET: 'integration-test-client-secret',
      GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    };
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const passwordHash = await argon2.hash('TestPass123!');
    const therapist = await prisma.user.create({
      data: {
        email: `consultations-google-fail-${runId}@example.com`,
        passwordHash,
        name: 'Dra. Google Fallando',
      },
    });
    therapistId = therapist.id;

    const patient = await prisma.patient.create({
      data: {
        fullName: 'Paciente Google Fallando',
        rut: `${runId}-7`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
      },
    });
    patientId = patient.id;

    const tokenCrypto = new GoogleTokenCryptoService(buildConfig());
    tokenCrypto.onModuleInit();

    await prisma.googleCalendarConnection.create({
      data: {
        therapistId,
        status: 'CONNECTED',
        calendarId: 'primary',
        refreshTokenEncrypted: Uint8Array.from(
          tokenCrypto.encrypt(Buffer.from('fake-refresh-token', 'utf-8')),
        ),
        scope: 'calendar.events',
        connectedAt: new Date(),
      },
    });

    googleCalendarClient = {
      insertEvent: jest
        .fn()
        .mockRejectedValue(
          new GoogleCalendarError('transient', 'Google no disponible (test)'),
        ),
      patchEvent: jest
        .fn()
        .mockRejectedValue(
          new GoogleCalendarError('transient', 'Google no disponible (test)'),
        ),
      deleteEvent: jest
        .fn()
        .mockRejectedValue(
          new GoogleCalendarError('transient', 'Google no disponible (test)'),
        ),
    };

    const calendarSync = new CalendarSyncService(
      prisma,
      tokenCrypto,
      googleCalendarClient as unknown as GoogleCalendarClient,
      new NotificationsService(prisma),
      buildConfig(),
    );
    const auditService = new AuditService(prisma);
    const patientsService = new PatientsService(
      prisma,
      auditService,
      calendarSync,
    );
    consultationsService = new ConsultationsService(
      prisma,
      patientsService,
      calendarSync,
      buildDisabledPaymentsService(prisma),
    );
  }, 30000);

  afterAll(async () => {
    await prisma.calendarEventLink.deleteMany({
      where: { connection: { therapistId } },
    });
    await prisma.consultationHistory.deleteMany({
      where: { editedById: therapistId },
    });
    await prisma.consultation.deleteMany({ where: { therapistId } });
    await prisma.googleCalendarConnection.deleteMany({
      where: { therapistId },
    });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.onModuleDestroy();
  }, 30000);

  // Deja tiempo a la promesa fire-and-forget (con su propio .catch interno)
  // para resolverse antes de que Jest cierre el test -- si el rechazo
  // escapara sin capturar, esto lo dejaría como unhandledRejection.
  async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('create() se resuelve exitosamente aunque insertEvent rechace siempre', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const consultation = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-04-10',
        consultReason: 'Motivo de integración',
        intervention: 'Intervención de integración',
      } as never,
      therapistId,
    );

    expect(consultation.id).toBeDefined();
    const persisted = await prisma.consultation.findUnique({
      where: { id: consultation.id },
    });
    expect(persisted).not.toBeNull();

    await flushMicrotasks();
    expect(googleCalendarClient.insertEvent).toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();

    process.off('unhandledRejection', unhandled);
  }, 15000);

  it('correct() se resuelve exitosamente aunque patchEvent/insertEvent rechacen siempre', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const original = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-04-15',
        consultReason: 'Motivo de integración',
        intervention: 'Intervención de integración',
      } as never,
      therapistId,
    );
    await flushMicrotasks();

    const corrected = await consultationsService.correct(
      original.id,
      { consultReason: 'Motivo corregido de integración' } as never,
      therapistId,
    );

    expect(corrected.id).toBeDefined();
    expect(corrected.correctsId).toBe(original.id);
    const persisted = await prisma.consultation.findUnique({
      where: { id: corrected.id },
    });
    expect(persisted).not.toBeNull();

    await flushMicrotasks();
    expect(unhandled).not.toHaveBeenCalled();

    process.off('unhandledRejection', unhandled);
  }, 15000);
});

// sdd/session-calendar-view PR1 (T1.7): design.md "Range query params are
// ISO instants with explicit offset, half-open" -- real Prisma, sin mocks de
// findMany, para probar filtrado de cadena corregida y bordes de mes con
// cambio de horario en Chile (Sep/Abr).
describe('ConsultationsService.findByRange (integration, real Prisma)', () => {
  let prisma: PrismaService;
  let consultationsService: ConsultationsService;
  const runId = Date.now() + 1;

  let therapistId: string;
  let patientId: string;

  function buildConfig(): ConfigService {
    const values: Record<string, string> = {
      FRONTEND_URL: 'https://app.umbral.cl',
      GOOGLE_CLIENT_ID: 'integration-test-client-id',
      GOOGLE_CLIENT_SECRET: 'integration-test-client-secret',
      GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    };
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const passwordHash = await argon2.hash('TestPass123!');
    const therapist = await prisma.user.create({
      data: {
        email: `consultations-range-${runId}@example.com`,
        passwordHash,
        name: 'Dra. Rango',
      },
    });
    therapistId = therapist.id;

    const patient = await prisma.patient.create({
      data: {
        fullName: 'Paciente Rango',
        rut: `${runId}-5`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
      },
    });
    patientId = patient.id;

    const tokenCrypto = new GoogleTokenCryptoService(buildConfig());
    tokenCrypto.onModuleInit();

    const googleCalendarClient = {
      insertEvent: jest
        .fn()
        .mockRejectedValue(
          new GoogleCalendarError('transient', 'Google no disponible (test)'),
        ),
      patchEvent: jest
        .fn()
        .mockRejectedValue(
          new GoogleCalendarError('transient', 'Google no disponible (test)'),
        ),
      deleteEvent: jest
        .fn()
        .mockRejectedValue(
          new GoogleCalendarError('transient', 'Google no disponible (test)'),
        ),
    };

    const calendarSync = new CalendarSyncService(
      prisma,
      tokenCrypto,
      googleCalendarClient as unknown as GoogleCalendarClient,
      new NotificationsService(prisma),
      buildConfig(),
    );
    const auditService = new AuditService(prisma);
    const patientsService = new PatientsService(
      prisma,
      auditService,
      calendarSync,
    );
    consultationsService = new ConsultationsService(
      prisma,
      patientsService,
      calendarSync,
      buildDisabledPaymentsService(prisma),
    );
  }, 30000);

  afterAll(async () => {
    await prisma.calendarEventLink.deleteMany({
      where: { connection: { therapistId } },
    });
    await prisma.consultationHistory.deleteMany({
      where: { editedById: therapistId },
    });
    await prisma.consultation.deleteMany({ where: { therapistId } });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.onModuleDestroy();
  }, 30000);

  async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('una cadena corregida aparece una sola vez (la versión vigente)', async () => {
    const original = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-09-10T15:00:00Z',
        consultReason: 'Motivo original',
        intervention: 'Intervención original',
      } as never,
      therapistId,
    );
    await flushMicrotasks();

    const corrected = await consultationsService.correct(
      original.id,
      { consultReason: 'Motivo corregido' } as never,
      therapistId,
    );
    await flushMicrotasks();

    const sessions = await consultationsService.findByRange(therapistId, {
      from: '2026-09-01T00:00:00-04:00',
      to: '2026-10-01T00:00:00-03:00',
    });

    const matches = sessions.filter((s) => s.groupId === original.groupId);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(corrected.id);
    expect(matches[0].id).not.toBe(original.id);
  }, 20000);

  it('un mes con boundary DST (septiembre 2026, Chile) incluye las sesiones de borde del rango half-open', async () => {
    const edgeStart = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-09-01T00:00:00-04:00',
        consultReason: 'Motivo borde inicio de rango',
        intervention: 'Intervención',
      } as never,
      therapistId,
    );
    const edgeEnd = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-09-30T23:59:59-03:00',
        consultReason: 'Motivo borde fin de rango (post cambio de horario)',
        intervention: 'Intervención',
      } as never,
      therapistId,
    );
    const justOutsideBefore = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-08-31T23:59:59-04:00',
        consultReason: 'Motivo justo antes del rango',
        intervention: 'Intervención',
      } as never,
      therapistId,
    );
    const exactlyAtTo = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-10-01T00:00:00-03:00',
        consultReason: 'Motivo exactamente en el límite "to" (exclusivo)',
        intervention: 'Intervención',
      } as never,
      therapistId,
    );
    await flushMicrotasks();

    const sessions = await consultationsService.findByRange(therapistId, {
      from: '2026-09-01T00:00:00-04:00',
      to: '2026-10-01T00:00:00-03:00',
    });
    const ids = sessions.map((s) => s.id);

    expect(ids).toContain(edgeStart.id);
    expect(ids).toContain(edgeEnd.id);
    expect(ids).not.toContain(justOutsideBefore.id);
    expect(ids).not.toContain(exactlyAtTo.id);
  }, 20000);
});

// sdd/online-payment-integration PR 1 (T3.5/T3.7/T3.9): real Prisma + un
// gateway que rechaza SIEMPRE (UnconfiguredPaymentGatewayClient, el binding
// por default de PR 1) -- mismo criterio que el describe "Google client
// failing" de arriba: create()/correct() deben resolver igual de bien que
// si el gateway de pago nunca hubiera existido (design.md "Nothing in this
// module can fail a clinical write").
describe('ConsultationsService + PaymentsService (integration, gateway stub throwing)', () => {
  let prisma: PrismaService;
  let consultationsService: ConsultationsService;
  let paymentsService: PaymentsService;
  const runId = Date.now() + 2;

  let therapistId: string;
  let patientId: string;

  function buildConfig(): ConfigService {
    const values: Record<string, string> = {
      FRONTEND_URL: 'https://app.umbral.cl',
      GOOGLE_CLIENT_ID: 'integration-test-client-id',
      GOOGLE_CLIENT_SECRET: 'integration-test-client-secret',
      GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    };
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const passwordHash = await argon2.hash('TestPass123!');
    const therapist = await prisma.user.create({
      data: {
        email: `consultations-payments-${runId}@example.com`,
        passwordHash,
        name: 'Dra. Pagos',
      },
    });
    therapistId = therapist.id;

    await prisma.paymentAccount.create({
      data: {
        therapistId,
        status: 'CONNECTED',
        merchantId: `merchant-${runId}`,
      },
    });

    const patient = await prisma.patient.create({
      data: {
        fullName: 'Paciente Pagos',
        rut: `${runId}-3`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
        defaultSessionAmount: 30000,
      },
    });
    patientId = patient.id;

    const tokenCrypto = new GoogleTokenCryptoService(buildConfig());
    tokenCrypto.onModuleInit();

    const googleCalendarClient = {
      insertEvent: jest.fn().mockResolvedValue({ id: 'google-event-1' }),
      patchEvent: jest.fn().mockResolvedValue(undefined),
      deleteEvent: jest.fn().mockResolvedValue(undefined),
    };
    const calendarSync = new CalendarSyncService(
      prisma,
      tokenCrypto,
      googleCalendarClient as unknown as GoogleCalendarClient,
      new NotificationsService(prisma),
      buildConfig(),
    );
    const auditService = new AuditService(prisma);
    const patientsService = new PatientsService(
      prisma,
      auditService,
      calendarSync,
    );

    paymentsService = new PaymentsService(
      prisma,
      new UnconfiguredPaymentGatewayClient(),
      buildConfig(),
    );
    consultationsService = new ConsultationsService(
      prisma,
      patientsService,
      calendarSync,
      paymentsService,
    );
  }, 30000);

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { therapistId } });
    await prisma.consultationHistory.deleteMany({
      where: { editedById: therapistId },
    });
    await prisma.consultation.deleteMany({ where: { therapistId } });
    await prisma.paymentAccount.deleteMany({ where: { therapistId } });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.onModuleDestroy();
  }, 30000);

  async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // emitPaymentCharge() es fire-and-forget (T2.5) -- bajo la suite completa
  // corriendo en paralelo contra el Postgres aislado, un flushMicrotasks()
  // de tiempo fijo es intermitente. Poll acotado en vez de un sleep fijo:
  // espera hasta que la fila exista (o el timeout), nunca más de lo
  // necesario.
  async function waitForPayment(
    groupId: string,
    timeoutMs = 3000,
  ): Promise<Awaited<ReturnType<typeof prisma.payment.findUnique>>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const payment = await prisma.payment.findUnique({ where: { groupId } });
      if (payment || Date.now() >= deadline) return payment;
      await flushMicrotasks();
    }
  }

  // T3.7/T3.8: el gateway rechaza toda llamada a createOrder -- create()
  // debe igual devolver 201 con la fila clínica intacta, y el Payment queda
  // creado PENDING sin token/paymentUrl.
  it('create() se resuelve exitosamente y crea el Payment aunque createOrder rechace siempre', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const consultation = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-05-10',
        consultReason: 'Motivo de integración de pagos',
        intervention: 'Intervención de integración',
      } as never,
      therapistId,
    );

    expect(consultation.id).toBeDefined();
    const payment = await waitForPayment(consultation.groupId);
    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('PENDING');
    expect(payment?.amount).toBe(30000);
    expect(payment?.gatewayToken).toBeNull();
    expect(unhandled).not.toHaveBeenCalled();

    process.off('unhandledRejection', unhandled);
  }, 15000);

  // T3.5/T3.6: correct() que mueve sessionDate actualiza el MISMO Payment
  // (mismo groupId) y su dueDate, nunca crea un segundo cargo.
  it('correct() que cambia sessionDate actualiza el mismo Payment y mueve dueDate, sin crear un segundo cargo', async () => {
    const original = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-05-15',
        consultReason: 'Motivo original',
        intervention: 'Intervención original',
      } as never,
      therapistId,
    );
    const beforeCorrection = await waitForPayment(original.groupId);
    expect(beforeCorrection).not.toBeNull();

    const corrected = await consultationsService.correct(
      original.id,
      { sessionDate: '2026-05-20' } as never,
      therapistId,
    );

    // Poll hasta que dueDate refleje el nuevo sessionDate (o el timeout) --
    // la sola existencia de la fila no basta acá, el update es un segundo
    // paso async dentro de la misma cadena fire-and-forget.
    const deadline = Date.now() + 3000;
    let afterCorrection = await prisma.payment.findUnique({
      where: { groupId: original.groupId },
    });
    while (
      afterCorrection?.dueDate.getTime() ===
        beforeCorrection?.dueDate.getTime() &&
      Date.now() < deadline
    ) {
      await flushMicrotasks();
      afterCorrection = await prisma.payment.findUnique({
        where: { groupId: original.groupId },
      });
    }
    const allPaymentsForGroup = await prisma.payment.findMany({
      where: { groupId: original.groupId },
    });

    expect(corrected.id).not.toBe(original.id);
    expect(afterCorrection?.id).toBe(beforeCorrection?.id);
    expect(allPaymentsForGroup).toHaveLength(1);
    expect(afterCorrection?.dueDate.toISOString()).not.toBe(
      beforeCorrection?.dueDate.toISOString(),
    );
    expect(afterCorrection?.amount).toBe(beforeCorrection?.amount);
  }, 15000);

  // T3.9: el amount ya snapshoteado en un cargo existente no se ve afectado
  // por un cambio posterior de Patient.defaultSessionAmount.
  it('el amount snapshot sobrevive a un cambio posterior de defaultSessionAmount', async () => {
    const consultation = await consultationsService.create(
      {
        patientId,
        sessionDate: '2026-05-25',
        consultReason: 'Motivo snapshot',
        intervention: 'Intervención snapshot',
      } as never,
      therapistId,
    );
    const paymentBefore = await waitForPayment(consultation.groupId);
    expect(paymentBefore?.amount).toBe(30000);

    await prisma.patient.update({
      where: { id: patientId },
      data: { defaultSessionAmount: 99999 },
    });

    // Simula una corrección posterior sobre la misma cadena -- ensureCharge
    // se vuelve a invocar (mismo groupId) y no debe re-snapshotear el
    // amount con el nuevo defaultSessionAmount.
    const correctedConsultation = await consultationsService.correct(
      consultation.id,
      { consultReason: 'Motivo corregido tras cambiar el default' } as never,
      therapistId,
    );
    // No hay una señal directa de "ensureCharge terminó" tras correct() --
    // el groupId de la cadena no cambia, así que se espera a que la fila
    // clínica corregida quede visible como proxy de que la tx (y su
    // fire-and-forget disparado desde adentro) ya corrió.
    expect(correctedConsultation.groupId).toBe(consultation.groupId);
    await flushMicrotasks();
    await flushMicrotasks();

    const paymentAfter = await prisma.payment.findUnique({
      where: { groupId: consultation.groupId },
    });
    expect(paymentAfter?.amount).toBe(30000);

    // Revertir para no afectar otros tests que lean este paciente.
    await prisma.patient.update({
      where: { id: patientId },
      data: { defaultSessionAmount: 30000 },
    });
  }, 15000);
});

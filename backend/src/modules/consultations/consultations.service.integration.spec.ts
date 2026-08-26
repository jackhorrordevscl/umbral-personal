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

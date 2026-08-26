import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CalendarSyncService } from './calendar-sync.service';
import type { GoogleCalendarClient } from './google-calendar.client';
import { BACKFILL_WINDOW_DAYS } from './calendar-integration.constants';

/**
 * sdd/google-calendar-integration PR 2 (T6.9/T6.10/T6.13/T6.14): a
 * diferencia de calendar-sync.service.spec.ts (Prisma mockeado), estos tests
 * corren contra Postgres real -- verifican invariantes que ningún mock puede
 * probar: que `correct()` (una fila NUEVA con el mismo groupId) resuelve al
 * MISMO link real vía la restricción @@unique(connectionId, groupId), que el
 * backfill respeta la ventana real vía el WHERE de sessionDate, y que
 * deletePatientEvents solo toca links de sesiones futuras. Solo
 * GoogleCalendarClient se mockea (es la única llamada de red real).
 * Requiere DATABASE_URL/DIRECT_URL apuntando a Postgres (docker-compose.yml
 * en la raíz del repo) -- mismo patrón que
 * reminders.service.integration.spec.ts.
 */
describe('CalendarSyncService (integration, real Prisma)', () => {
  let prisma: PrismaService;
  let tokenCrypto: GoogleTokenCryptoService;
  let googleCalendarClient: {
    insertEvent: jest.Mock;
    patchEvent: jest.Mock;
    deleteEvent: jest.Mock;
  };
  let service: CalendarSyncService;
  const runId = Date.now();

  let therapistId: string;
  let patientId: string;
  let connectionId: string;

  const FRONTEND_URL = 'https://app.umbral.cl';
  const GOOGLE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

  function buildConfig(): ConfigService {
    const values: Record<string, string> = {
      FRONTEND_URL,
      GOOGLE_CLIENT_ID: 'integration-test-client-id',
      GOOGLE_CLIENT_SECRET: 'integration-test-client-secret',
      GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_TOKEN_KEY,
    };
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  async function createConsultation(
    groupId: string,
    sessionDate: Date,
    overrides: { correctsId?: string; id?: string } = {},
  ) {
    const id = overrides.id ?? randomUUID();
    return prisma.consultation.create({
      data: {
        id,
        groupId,
        patientId,
        therapistId,
        sessionDate,
        consultReason: 'Motivo de integración',
        intervention: 'Intervención de integración',
        scheduledAt: sessionDate,
        patientRut: `${runId}-9`,
        correctsId: overrides.correctsId,
      },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();

    const passwordHash = await argon2.hash('TestPass123!');
    const therapist = await prisma.user.create({
      data: {
        email: `calendar-sync-integration-${runId}@example.com`,
        passwordHash,
        name: 'Dra. Sync Integración',
      },
    });
    therapistId = therapist.id;

    const patient = await prisma.patient.create({
      data: {
        fullName: 'Paciente Sync Integración',
        rut: `${runId}-8`,
        birthDate: new Date('1990-01-01T12:00:00.000Z'),
        therapistId,
      },
    });
    patientId = patient.id;

    tokenCrypto = new GoogleTokenCryptoService(buildConfig());
    tokenCrypto.onModuleInit();

    const connection = await prisma.googleCalendarConnection.create({
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
    connectionId = connection.id;
  }, 30000);

  beforeEach(() => {
    googleCalendarClient = {
      insertEvent: jest.fn(),
      patchEvent: jest.fn(),
      deleteEvent: jest.fn(),
    };
    service = new CalendarSyncService(
      prisma,
      tokenCrypto,
      googleCalendarClient as unknown as GoogleCalendarClient,
      new NotificationsService(prisma),
      buildConfig(),
    );
  });

  afterEach(async () => {
    // Deja cada test con sus propias filas -- limpia consultas/links entre
    // tests para que las cuentas de llamadas (insertEvent/patchEvent) no se
    // contaminen entre casos.
    await prisma.calendarEventLink.deleteMany({ where: { connectionId } });
    await prisma.consultation.deleteMany({ where: { therapistId } });
  });

  afterAll(async () => {
    await prisma.calendarEventLink.deleteMany({ where: { connectionId } });
    await prisma.consultation.deleteMany({ where: { therapistId } });
    await prisma.googleCalendarConnection.deleteMany({
      where: { therapistId },
    });
    await prisma.patient.deleteMany({ where: { id: patientId } });
    await prisma.user.deleteMany({ where: { id: therapistId } });
    await prisma.onModuleDestroy();
  }, 30000);

  describe('correct() resuelve al mismo link real (T6.9/T6.10)', () => {
    it('sessionDate: correct() parchea el mismo googleEventId, nunca inserta uno nuevo', async () => {
      const groupId = randomUUID();
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-real-1',
      });
      googleCalendarClient.patchEvent.mockResolvedValue({
        id: 'google-event-real-1',
      });

      const original = await createConsultation(
        groupId,
        new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        { id: groupId },
      );
      await service.syncGroup(groupId);

      expect(googleCalendarClient.insertEvent).toHaveBeenCalledTimes(1);
      const linkAfterCreate = await prisma.calendarEventLink.findUnique({
        where: { connectionId_groupId: { connectionId, groupId } },
      });
      expect(linkAfterCreate?.googleEventId).toBe('google-event-real-1');

      // correct() real: fila NUEVA con el mismo groupId, correctsId a la
      // original -- la original nunca se toca (consultations.service.ts).
      const newSessionDate = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
      await createConsultation(groupId, newSessionDate, {
        correctsId: original.id,
      });
      await service.syncGroup(groupId);

      expect(googleCalendarClient.insertEvent).toHaveBeenCalledTimes(1); // sigue en 1, nunca duplica
      expect(googleCalendarClient.patchEvent).toHaveBeenCalledTimes(1);
      expect(googleCalendarClient.patchEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'google-event-real-1', // el MISMO googleEventId
        expect.anything(),
      );
      const linkAfterCorrect = await prisma.calendarEventLink.findUnique({
        where: { connectionId_groupId: { connectionId, groupId } },
      });
      expect(linkAfterCorrect?.googleEventId).toBe('google-event-real-1');
      expect(linkAfterCorrect?.lastSessionDate.getTime()).toBe(
        newSessionDate.getTime(),
      );
    });

    it('una corrección solo de texto (sessionDate sin cambios) igual parchea una vez, nunca inserta', async () => {
      const groupId = randomUUID();
      const sessionDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-real-2',
      });
      googleCalendarClient.patchEvent.mockResolvedValue({
        id: 'google-event-real-2',
      });

      const original = await createConsultation(groupId, sessionDate, {
        id: groupId,
      });
      await service.syncGroup(groupId);

      // Corrección de texto: mismo sessionDate, solo cambia consultReason en
      // los datos reales -- lo relevante para syncGroup es que el link ya
      // existe, así que SIEMPRE debe patchear (nunca diffea contenido).
      await createConsultation(groupId, sessionDate, {
        correctsId: original.id,
      });
      await service.syncGroup(groupId);

      expect(googleCalendarClient.insertEvent).toHaveBeenCalledTimes(1);
      expect(googleCalendarClient.patchEvent).toHaveBeenCalledTimes(1);
      expect(googleCalendarClient.patchEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'google-event-real-2',
        expect.anything(),
      );
    });
  });

  describe('backfill: una sola pasada acotada por conexión (T6.13)', () => {
    it('sincroniza sesiones futuras dentro de la ventana y ninguna fuera de ella', async () => {
      googleCalendarClient.insertEvent.mockImplementation(() =>
        Promise.resolve({ id: `google-event-${randomUUID()}` }),
      );

      const inWindowGroupId = randomUUID();
      const outOfWindowGroupId = randomUUID();
      await createConsultation(
        inWindowGroupId,
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // +10d, dentro de 90d
        { id: inWindowGroupId },
      );
      await createConsultation(
        outOfWindowGroupId,
        new Date(
          Date.now() + (BACKFILL_WINDOW_DAYS + 10) * 24 * 60 * 60 * 1000,
        ), // +100d, fuera de 90d
        { id: outOfWindowGroupId },
      );

      await service.reconcile();

      expect(googleCalendarClient.insertEvent).toHaveBeenCalledTimes(1);

      const inWindowLink = await prisma.calendarEventLink.findUnique({
        where: {
          connectionId_groupId: { connectionId, groupId: inWindowGroupId },
        },
      });
      expect(inWindowLink).not.toBeNull();

      const outOfWindowLink = await prisma.calendarEventLink.findUnique({
        where: {
          connectionId_groupId: {
            connectionId,
            groupId: outOfWindowGroupId,
          },
        },
      });
      expect(outOfWindowLink).toBeNull();
    }, 15000);
  });

  describe('deletePatientEvents: solo sesiones futuras (T6.14)', () => {
    it('elimina el evento y el link de una sesión futura, deja intacto un link de una sesión pasada', async () => {
      googleCalendarClient.deleteEvent.mockResolvedValue(undefined);

      const futureGroupId = randomUUID();
      const pastGroupId = randomUUID();
      await createConsultation(
        futureGroupId,
        new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        { id: futureGroupId },
      );
      await createConsultation(
        pastGroupId,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        { id: pastGroupId },
      );
      await prisma.calendarEventLink.create({
        data: {
          connectionId,
          groupId: futureGroupId,
          googleEventId: 'google-event-future',
          lastSessionDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          syncStatus: 'SYNCED',
        },
      });
      await prisma.calendarEventLink.create({
        data: {
          connectionId,
          groupId: pastGroupId,
          googleEventId: 'google-event-past',
          lastSessionDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          syncStatus: 'SYNCED',
        },
      });

      await service.deletePatientEvents(patientId);

      expect(googleCalendarClient.deleteEvent).toHaveBeenCalledTimes(1);
      expect(googleCalendarClient.deleteEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'google-event-future',
      );

      const futureLink = await prisma.calendarEventLink.findUnique({
        where: {
          connectionId_groupId: { connectionId, groupId: futureGroupId },
        },
      });
      expect(futureLink).toBeNull();

      const pastLink = await prisma.calendarEventLink.findUnique({
        where: {
          connectionId_groupId: { connectionId, groupId: pastGroupId },
        },
      });
      expect(pastLink).not.toBeNull(); // untouched -- deletePatientEvents solo mira sessionDate futura
    }, 15000);
  });
});

import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { CalendarSyncService } from './calendar-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from './google-calendar.client';
import { NotificationsService } from '../notifications/notifications.service';

// sdd/google-calendar-integration PR 2: capa de aplicación de
// CalendarSyncService con Prisma/GoogleCalendarClient/NotificationsService
// mockeados (infraestructura real, mismo criterio que
// reminders.service.spec.ts) -- cubre T6.3-T6.8: minimización de contenido,
// invalid_grant -> DISCONNECTED + notificación única, y que el reconciler
// nunca borre un evento solo por salir de la ventana de 90 días. Los tests
// de integración con Prisma real (T6.9-T6.14) viven en
// calendar-sync.service.integration.spec.ts.
function buildConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'connection-1',
    therapistId: 'therapist-1',
    status: 'CONNECTED',
    disconnectReason: null,
    googleAccountEmail: null,
    calendarId: 'primary',
    refreshTokenEncrypted: Buffer.from('encrypted-refresh-token'),
    scope: 'calendar.events',
    stateNonceHash: null,
    stateExpiresAt: null,
    connectedAt: new Date(),
    disconnectedAt: null,
    lastSyncAt: null,
    lastError: null,
    ...overrides,
  };
}

function buildConsultation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'consultation-1',
    groupId: 'group-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    sessionDate: new Date('2026-03-10T12:00:00.000Z'),
    consultReason: 'Motivo clínico confidencial',
    intervention: 'Intervención clínica confidencial',
    agreements: 'Acuerdos clínicos confidenciales',
    nextSessionDate: null,
    sessionType: 'IN_PERSON',
    createdAt: new Date(),
    scheduledAt: new Date('2026-03-10T12:00:00.000Z'),
    patientRut: '11111111-1',
    deletedAt: null,
    correctsId: null,
    patient: {
      id: 'patient-1',
      fullName: 'Juan Pablo Martínez Contreras',
      deletedAt: null,
    },
    ...overrides,
  };
}

describe('CalendarSyncService', () => {
  let service: CalendarSyncService;
  let prisma: {
    consultation: { findFirst: jest.Mock; findMany: jest.Mock };
    googleCalendarConnection: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    calendarEventLink: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let tokenCrypto: { decrypt: jest.Mock };
  let googleCalendarClient: {
    insertEvent: jest.Mock;
    patchEvent: jest.Mock;
    deleteEvent: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let config: { get: jest.Mock };

  function buildService(): CalendarSyncService {
    return new CalendarSyncService(
      prisma as unknown as PrismaService,
      tokenCrypto as unknown as GoogleTokenCryptoService,
      googleCalendarClient as unknown as GoogleCalendarClient,
      notificationsService as unknown as NotificationsService,
      config as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    prisma = {
      consultation: { findFirst: jest.fn(), findMany: jest.fn() },
      googleCalendarConnection: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      calendarEventLink: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
    };
    tokenCrypto = {
      decrypt: jest.fn().mockReturnValue(Buffer.from('plain-refresh-token')),
    };
    googleCalendarClient = {
      insertEvent: jest.fn(),
      patchEvent: jest.fn(),
      deleteEvent: jest.fn(),
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          FRONTEND_URL: 'https://app.umbral.cl',
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        };
        return values[key];
      }),
    };
    service = buildService();
  });

  describe('syncGroup — minimización de contenido (T6.3/T6.4)', () => {
    it('crea un evento nuevo cuando no existe link previo', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-1',
      });

      await service.syncGroup('group-1');

      expect(googleCalendarClient.insertEvent).toHaveBeenCalledTimes(1);
      expect(prisma.calendarEventLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectionId: 'connection-1',
            groupId: 'group-1',
            googleEventId: 'google-event-1',
            syncStatus: 'SYNCED',
          }) as unknown,
        }),
      );
    });

    it('el cuerpo del evento no contiene rut, fullName, consultReason, intervention, agreements ni sessionType', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-1',
      });

      await service.syncGroup('group-1');

      const [, , eventBody] = googleCalendarClient.insertEvent.mock
        .calls[0] as [unknown, unknown, Record<string, unknown>];
      const serialized = JSON.stringify(eventBody);

      expect(serialized).not.toContain('11111111-1'); // rut
      expect(serialized).not.toContain('Martínez'); // fullName
      expect(serialized).not.toContain('Contreras'); // fullName
      expect(serialized).not.toContain('Motivo clínico confidencial'); // consultReason
      expect(serialized).not.toContain('Intervención clínica confidencial'); // intervention
      expect(serialized).not.toContain('Acuerdos clínicos confidenciales'); // agreements
      expect(serialized).not.toContain('IN_PERSON'); // sessionType
    });

    it('el cuerpo del evento contiene las iniciales, el código corto y el deep link', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-1',
      });

      await service.syncGroup('group-1');

      const [, , eventBody] = googleCalendarClient.insertEvent.mock
        .calls[0] as [
        unknown,
        unknown,
        { summary: string; description: string },
      ];

      expect(eventBody.summary).toContain('JM-');
      expect(eventBody.description).toContain(
        'https://app.umbral.cl/consultations/consultation-1',
      );
    });

    it('actualiza (patch) el mismo googleEventId cuando ya existe un link para ese groupId', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue({
        id: 'link-1',
        connectionId: 'connection-1',
        groupId: 'group-1',
        googleEventId: 'google-event-existing',
        lastSessionDate: new Date('2026-03-01T12:00:00.000Z'),
        syncStatus: 'SYNCED',
        lastError: null,
      });
      googleCalendarClient.patchEvent.mockResolvedValue({
        id: 'google-event-existing',
      });

      await service.syncGroup('group-1');

      expect(googleCalendarClient.patchEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'google-event-existing',
        expect.anything(),
      );
      expect(googleCalendarClient.insertEvent).not.toHaveBeenCalled();
      expect(prisma.calendarEventLink.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'link-1' },
          data: expect.objectContaining({ syncStatus: 'SYNCED' }) as unknown,
        }),
      );
    });

    it('no hace nada si no hay conexión CONNECTED para el terapeuta', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(null);

      await service.syncGroup('group-1');

      expect(googleCalendarClient.insertEvent).not.toHaveBeenCalled();
      expect(googleCalendarClient.patchEvent).not.toHaveBeenCalled();
    });

    it('no hace nada si GOOGLE_CALENDAR_SYNC_ENABLED=false (gate de write-path)', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'GOOGLE_CALENDAR_SYNC_ENABLED' ? 'false' : undefined,
      );
      service = buildService();

      await service.syncGroup('group-1');

      expect(prisma.consultation.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('invalid_grant → DISCONNECTED + notificación única (T6.5/T6.6)', () => {
    function setupInvalidGrant(updateManyCount: number) {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockRejectedValue(
        new GoogleCalendarError('invalid_grant', '401'),
      );
      prisma.googleCalendarConnection.updateMany.mockResolvedValue({
        count: updateManyCount,
      });
      prisma.googleCalendarConnection.findUnique
        .mockResolvedValueOnce(buildConnection()) // primer findUnique en syncGroup
        .mockResolvedValue(buildConnection({ therapistId: 'therapist-1' }));
    }

    it('la primera falla invalid_grant marca DISCONNECTED y notifica exactamente una vez', async () => {
      setupInvalidGrant(1);

      await service.syncGroup('group-1');

      expect(prisma.googleCalendarConnection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'connection-1', status: 'CONNECTED' },
          data: expect.objectContaining({
            status: 'DISCONNECTED',
            refreshTokenEncrypted: null,
          }) as unknown,
        }),
      );
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'therapist-1',
          type: NotificationType.GOOGLE_CALENDAR_DISCONNECTED,
        }) as unknown,
      );
    });

    it('una segunda falla sobre una conexión ya DISCONNECTED no emite ninguna notificación', async () => {
      setupInvalidGrant(0); // updateMany no afecta filas: ya no está CONNECTED

      await service.syncGroup('group-1');

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('reconcile — drift de fecha vs. ventana de 90 días (T6.7/T6.8)', () => {
    it('un link cuyo sessionDate se movió a +200 días se actualiza (patch), nunca se borra', async () => {
      const connection = buildConnection();
      prisma.googleCalendarConnection.findMany.mockResolvedValue([connection]);
      prisma.calendarEventLink.findMany
        .mockResolvedValueOnce([]) // repairFailedLinks: sin FAILED
        .mockResolvedValueOnce([
          {
            id: 'link-1',
            connectionId: 'connection-1',
            groupId: 'group-1',
            googleEventId: 'google-event-1',
            lastSessionDate: new Date('2026-03-01T12:00:00.000Z'),
            syncStatus: 'SYNCED',
          },
        ]) // deleteForRemovedConsultations
        .mockResolvedValueOnce([
          {
            id: 'link-1',
            connectionId: 'connection-1',
            groupId: 'group-1',
            googleEventId: 'google-event-1',
            lastSessionDate: new Date('2026-03-01T12:00:00.000Z'),
            syncStatus: 'SYNCED',
          },
        ]); // repairDriftedLinks

      const driftedConsultation = buildConsultation({
        sessionDate: new Date('2026-09-27T12:00:00.000Z'), // +200 días
      });
      prisma.consultation.findMany
        .mockResolvedValueOnce([
          { groupId: 'group-1', deletedAt: null, patient: { deletedAt: null } },
        ]) // deleteForRemovedConsultations: consulta activa, no elegible para borrar
        .mockResolvedValueOnce([
          { groupId: 'group-1', sessionDate: driftedConsultation.sessionDate },
        ]) // repairDriftedLinks: sessionDate distinta a lastSessionDate
        .mockResolvedValueOnce([]); // backfill: sin candidatos nuevos

      // syncGroup() vuelve a resolver todo desde cero para el groupId drifted
      prisma.consultation.findFirst.mockResolvedValue(driftedConsultation);
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(connection);
      prisma.calendarEventLink.findUnique.mockResolvedValue({
        id: 'link-1',
        connectionId: 'connection-1',
        groupId: 'group-1',
        googleEventId: 'google-event-1',
        lastSessionDate: new Date('2026-03-01T12:00:00.000Z'),
        syncStatus: 'SYNCED',
      });
      googleCalendarClient.patchEvent.mockResolvedValue({
        id: 'google-event-1',
      });

      await service.reconcile();

      expect(googleCalendarClient.patchEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'google-event-1',
        expect.anything(),
      );
      expect(googleCalendarClient.deleteEvent).not.toHaveBeenCalled();
    });

    it('no hace nada si GOOGLE_CALENDAR_SYNC_ENABLED=false (gate del cron)', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'GOOGLE_CALENDAR_SYNC_ENABLED' ? 'false' : undefined,
      );
      service = buildService();

      await service.reconcile();

      expect(prisma.googleCalendarConnection.findMany).not.toHaveBeenCalled();
    });
  });

  describe('purgeLinksOnAccountChange (T5.4)', () => {
    it('purga todos los links si el googleAccountEmail cambió', async () => {
      await service.purgeLinksOnAccountChange(
        'connection-1',
        'old@example.com',
        'new@example.com',
      );

      expect(prisma.calendarEventLink.deleteMany).toHaveBeenCalledWith({
        where: { connectionId: 'connection-1' },
      });
    });

    it('no purga nada si el email es el mismo', async () => {
      await service.purgeLinksOnAccountChange(
        'connection-1',
        'same@example.com',
        'same@example.com',
      );

      expect(prisma.calendarEventLink.deleteMany).not.toHaveBeenCalled();
    });

    it('no purga nada si no hay email previo o nuevo (caso actual: nunca se resuelve el email)', async () => {
      await service.purgeLinksOnAccountChange('connection-1', null, null);

      expect(prisma.calendarEventLink.deleteMany).not.toHaveBeenCalled();
    });
  });
});

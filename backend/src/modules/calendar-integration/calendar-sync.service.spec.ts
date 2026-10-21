import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma } from '@prisma/client';
import { CalendarSyncService } from './calendar-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from './google-calendar.client';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { deterministicEventId } from './google-event-id.util';
import {
  MAX_RECONCILE_PAGES,
  RECONCILE_BATCH_LIMIT,
} from './calendar-integration.constants';

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
    durationMinutes: 50,
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
    calendarBusyBlock: { deleteMany: jest.Mock };
  };
  let tokenCrypto: { decrypt: jest.Mock };
  let googleCalendarClient: {
    insertEvent: jest.Mock;
    patchEvent: jest.Mock;
    deleteEvent: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let config: { get: jest.Mock };
  let auditService: { log: jest.Mock };

  function buildService(): CalendarSyncService {
    return new CalendarSyncService(
      prisma as unknown as PrismaService,
      tokenCrypto as unknown as GoogleTokenCryptoService,
      googleCalendarClient as unknown as GoogleCalendarClient,
      notificationsService as unknown as NotificationsService,
      config as unknown as ConfigService,
      auditService as unknown as AuditService,
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
      calendarBusyBlock: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
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
        'https://app.umbral.cl/consultations?patientId=patient-1&consultationId=consultation-1',
      );
      expect(eventBody.description).not.toContain('/consultations/');
    });

    it.each([45, 60])(
      'el evento dura la durationMinutes de la consulta (%i min) al insertar',
      async (durationMinutes) => {
        prisma.consultation.findFirst.mockResolvedValue(
          buildConsultation({ durationMinutes }),
        );
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
          { start: { dateTime: string }; end: { dateTime: string } },
        ];
        const ms =
          new Date(eventBody.end.dateTime).getTime() -
          new Date(eventBody.start.dateTime).getTime();
        expect(ms).toBe(durationMinutes * 60 * 1000);
      },
    );

    it('al parchear un evento existente, el end refleja la durationMinutes vigente', async () => {
      prisma.consultation.findFirst.mockResolvedValue(
        buildConsultation({ durationMinutes: 60 }),
      );
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue({
        id: 'link-1',
        connectionId: 'connection-1',
        groupId: 'group-1',
        googleEventId: 'google-event-existing',
        lastSessionDate: new Date('2026-03-10T12:00:00.000Z'),
        syncStatus: 'SYNCED',
        lastError: null,
      });
      googleCalendarClient.patchEvent.mockResolvedValue({
        id: 'google-event-existing',
      });

      await service.syncGroup('group-1');

      const [, , , eventBody] = googleCalendarClient.patchEvent.mock
        .calls[0] as [unknown, unknown, unknown, { end: { dateTime: string } }];
      expect(eventBody.end.dateTime).toBe('2026-03-10T13:00:00.000Z');
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

    // issue #285 + #497: dos ejecuciones concurrentes sincronizan el mismo
    // grupo con el MISMO id de evento (la perdedora recibe 409 y parchea), así
    // que hay un solo evento en Google. La perdedora falla el create del link
    // con P2002 y NO debe borrar ese evento: es el del link ganador.
    it('P2002 al crear el link no propaga el error y no borra el evento compartido', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-shared',
      });
      prisma.calendarEventLink.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.syncGroup('group-1')).resolves.toBeUndefined();

      expect(googleCalendarClient.deleteEvent).not.toHaveBeenCalled();
    });

    // issue #497: el id es función de (conexión, grupo); un reintento tras
    // perder la respuesta de Google llega al mismo evento en vez de duplicarlo.
    it('inserta con un id de evento determinista por (conexión, grupo) y válido para Google', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({ id: 'ignored' });

      await service.syncGroup('group-1');
      await service.syncGroup('group-1');

      const ids = googleCalendarClient.insertEvent.mock.calls.map(
        (call) => (call as unknown[])[3],
      );
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[0]).toMatch(/^[0-9a-v]{5,1024}$/);
      expect(ids[0]).toBe(deterministicEventId('connection-1', 'group-1'));
      expect(ids[0]).not.toBe(deterministicEventId('connection-1', 'group-2'));
      expect(ids[0]).not.toBe(deterministicEventId('connection-2', 'group-1'));
    });

    it('crea el link con el id que devolvió Google, no con uno propio', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-from-google',
      });

      await service.syncGroup('group-1');

      expect(prisma.calendarEventLink.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          googleEventId: 'google-event-from-google',
        }) as unknown,
      });
    });

    it('un error de create del link que NO es P2002 no borra el evento y se propaga', async () => {
      prisma.consultation.findFirst.mockResolvedValue(buildConsultation());
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({
        id: 'google-event-1',
      });
      prisma.calendarEventLink.create.mockRejectedValue(new Error('db down'));

      await expect(service.syncGroup('group-1')).rejects.toThrow('db down');
      expect(googleCalendarClient.deleteEvent).not.toHaveBeenCalled();
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

  describe('deleteEventsForGroups (cierre de tratamiento)', () => {
    function linkFor(groupId: string) {
      return {
        id: `link-${groupId}`,
        connectionId: 'connection-1',
        groupId,
        googleEventId: `event-${groupId}`,
      };
    }

    it('borra el evento de cada groupId con la conexión CONNECTED del terapeuta', async () => {
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockImplementation(
        ({ where }: { where: { connectionId_groupId: { groupId: string } } }) =>
          Promise.resolve(linkFor(where.connectionId_groupId.groupId)),
      );
      googleCalendarClient.deleteEvent.mockResolvedValue(undefined);

      await service.deleteEventsForGroups('therapist-1', ['g-1', 'g-2']);

      expect(prisma.googleCalendarConnection.findUnique).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1' },
      });
      expect(googleCalendarClient.deleteEvent).toHaveBeenCalledTimes(2);
      expect(googleCalendarClient.deleteEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'event-g-1',
      );
      expect(googleCalendarClient.deleteEvent).toHaveBeenCalledWith(
        expect.anything(),
        'primary',
        'event-g-2',
      );
    });

    it('no hace nada con una lista vacía ni consulta la conexión', async () => {
      await service.deleteEventsForGroups('therapist-1', []);
      expect(prisma.googleCalendarConnection.findUnique).not.toHaveBeenCalled();
    });

    it('no hace nada si no hay conexión CONNECTED', async () => {
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection({ status: 'DISCONNECTED' }),
      );
      await service.deleteEventsForGroups('therapist-1', ['g-1']);
      expect(googleCalendarClient.deleteEvent).not.toHaveBeenCalled();
    });

    it('no hace nada si GOOGLE_CALENDAR_SYNC_ENABLED=false', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'GOOGLE_CALENDAR_SYNC_ENABLED' ? 'false' : undefined,
      );
      service = buildService();
      await service.deleteEventsForGroups('therapist-1', ['g-1']);
      expect(prisma.googleCalendarConnection.findUnique).not.toHaveBeenCalled();
    });

    it('un fallo en un grupo se loguea y no impide borrar los demás', async () => {
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockImplementation(
        ({ where }: { where: { connectionId_groupId: { groupId: string } } }) =>
          Promise.resolve(linkFor(where.connectionId_groupId.groupId)),
      );
      googleCalendarClient.deleteEvent
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.deleteEventsForGroups('therapist-1', ['g-1', 'g-2']),
      ).resolves.toBeUndefined();

      expect(googleCalendarClient.deleteEvent).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('g-1'));
      errorSpy.mockRestore();
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
          // issue #497: solo desconecta si el token que falló sigue siendo el
          // guardado; una reconexión en el medio no se pisa.
          where: {
            id: 'connection-1',
            status: 'CONNECTED',
            refreshTokenEncrypted: Buffer.from('encrypted-refresh-token'),
          },
          data: expect.objectContaining({
            status: 'DISCONNECTED',
            refreshTokenEncrypted: null,
            busySyncedAt: null,
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
      // issue #283: los bloques ocupados dejan de ser válidos al desconectar.
      expect(prisma.calendarBusyBlock.deleteMany).toHaveBeenCalledWith({
        where: { therapistId: 'therapist-1' },
      });
      // issue #119: la desconexión automática por invalid_grant también
      // deja rastro en AuditLog, no solo la notificación in-app.
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'therapist-1',
        action: 'CALENDAR_DISCONNECTED',
        resource: 'GoogleCalendarConnection',
        resourceId: 'therapist-1',
        detail: 'INVALID_GRANT',
      });
    });

    it('una segunda falla sobre una conexión ya DISCONNECTED no emite ninguna notificación ni auditoría', async () => {
      setupInvalidGrant(0); // updateMany no afecta filas: ya no está CONNECTED

      await service.syncGroup('group-1');

      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
      expect(prisma.calendarBusyBlock.deleteMany).not.toHaveBeenCalled();
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

  // issue #497: el drift solo comparaba sessionDate; un cambio de duración,
  // del id de la consulta vigente o de las iniciales del paciente sin mover la
  // fecha no llegaba nunca al evento de Google.
  describe('reconcile — drift del cuerpo del evento (issue #497)', () => {
    const SAME_DATE = new Date('2026-03-10T12:00:00.000Z');

    // Huella que el servicio guarda al crear el evento de `consultation`.
    async function storedHashFor(
      consultation: ReturnType<typeof buildConsultation>,
    ): Promise<string> {
      const connection = buildConnection();
      prisma.consultation.findFirst.mockResolvedValue(consultation);
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(connection);
      prisma.calendarEventLink.findUnique.mockResolvedValue(null);
      googleCalendarClient.insertEvent.mockResolvedValue({ id: 'event-1' });
      prisma.calendarEventLink.create.mockResolvedValue({});

      await service.syncGroup('group-1');

      const [{ data }] = prisma.calendarEventLink.create.mock.calls[0] as [
        { data: { lastBodyHash: string } },
      ];
      prisma.calendarEventLink.create.mockClear();
      googleCalendarClient.insertEvent.mockClear();
      return data.lastBodyHash;
    }

    // Corre un tick con un link SYNCED y la consulta vigente dada; devuelve
    // cuántas veces se parchó el evento.
    async function patchesAfterReconcile(
      lastBodyHash: string | null,
      current: ReturnType<typeof buildConsultation>,
    ): Promise<number> {
      const connection = buildConnection();
      const link = {
        id: 'link-1',
        connectionId: 'connection-1',
        groupId: 'group-1',
        googleEventId: 'google-event-1',
        lastSessionDate: SAME_DATE,
        lastBodyHash,
        syncStatus: 'SYNCED',
      };
      prisma.googleCalendarConnection.findMany.mockResolvedValue([connection]);
      prisma.calendarEventLink.findMany
        .mockResolvedValueOnce([]) // repairFailedLinks
        .mockResolvedValueOnce([link]) // deleteForRemovedConsultations
        .mockResolvedValueOnce([link]) // repairDriftedLinks
        .mockResolvedValue([]); // backfill
      prisma.consultation.findMany
        .mockResolvedValueOnce([
          { groupId: 'group-1', deletedAt: null, patient: { deletedAt: null } },
        ])
        .mockResolvedValueOnce([current])
        .mockResolvedValue([]);
      prisma.consultation.findFirst.mockResolvedValue(current);
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(connection);
      prisma.calendarEventLink.findUnique.mockResolvedValue(link);
      googleCalendarClient.patchEvent.mockResolvedValue({ id: 'event-1' });

      await service.reconcile();

      return googleCalendarClient.patchEvent.mock.calls.length;
    }

    it('guarda la huella del cuerpo al crear el evento', async () => {
      const hash = await storedHashFor(buildConsultation());

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('guarda la huella nueva al parchar el evento', async () => {
      const consultation = buildConsultation();
      prisma.consultation.findFirst.mockResolvedValue(consultation);
      prisma.googleCalendarConnection.findUnique.mockResolvedValue(
        buildConnection(),
      );
      prisma.calendarEventLink.findUnique.mockResolvedValue({
        id: 'link-1',
        googleEventId: 'google-event-1',
        lastBodyHash: 'huella-vieja',
      });
      googleCalendarClient.patchEvent.mockResolvedValue({ id: 'event-1' });

      await service.syncGroup('group-1');

      const [{ data }] = prisma.calendarEventLink.update.mock.calls[0] as [
        { data: { lastBodyHash: string } },
      ];
      expect(data.lastBodyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(data.lastBodyHash).not.toBe('huella-vieja');
    });

    it('parcha el evento si cambió la duración sin cambiar la fecha', async () => {
      const hash = await storedHashFor(buildConsultation());

      const patches = await patchesAfterReconcile(
        hash,
        buildConsultation({ durationMinutes: 90 }),
      );

      expect(patches).toBe(1);
    });

    it('parcha el evento si cambió el id de la consulta vigente (corrección)', async () => {
      const hash = await storedHashFor(buildConsultation());

      const patches = await patchesAfterReconcile(
        hash,
        buildConsultation({ id: 'consultation-2' }),
      );

      expect(patches).toBe(1);
    });

    it('parcha el evento si cambiaron las iniciales del paciente', async () => {
      const hash = await storedHashFor(buildConsultation());

      const patches = await patchesAfterReconcile(
        hash,
        buildConsultation({
          patient: {
            id: 'patient-1',
            fullName: 'Ana Rojas Soto',
            deletedAt: null,
          },
        }),
      );

      expect(patches).toBe(1);
    });

    it('no parcha si el cuerpo y la fecha no cambiaron', async () => {
      const hash = await storedHashFor(buildConsultation());

      const patches = await patchesAfterReconcile(hash, buildConsultation());

      expect(patches).toBe(0);
    });

    it('un link sin huella (anterior a la columna) compara solo la fecha y no se parcha', async () => {
      const patches = await patchesAfterReconcile(
        null,
        buildConsultation({ durationMinutes: 90 }),
      );

      expect(patches).toBe(0);
    });
  });

  // issue #286 (parte 2): antes cada método leía solo los primeros
  // RECONCILE_BATCH_LIMIT y el resto nunca se alcanzaba. Los mocks de Prisma no
  // validan el filtro real; acá se verifica el protocolo de paginación
  // (orden estable, cursor/keyset tras la última fila, tope de páginas).
  describe('reconcile — paginación completa (issue #286)', () => {
    function linkRow(index: number, syncStatus: 'SYNCED' | 'FAILED') {
      const n = String(index).padStart(5, '0');
      return {
        id: `link-${n}`,
        connectionId: 'connection-1',
        groupId: `group-${n}`,
        googleEventId: `event-${n}`,
        lastSessionDate: new Date('2026-03-10T12:00:00.000Z'),
        syncStatus,
      };
    }

    function pageOf(
      count: number,
      offset: number,
      syncStatus: 'SYNCED' | 'FAILED',
    ) {
      return Array.from({ length: count }, (_, i) =>
        linkRow(offset + i, syncStatus),
      );
    }

    interface LinkQuery {
      where: { syncStatus?: string; id?: { gt: string } };
      orderBy: { id: string };
      take: number;
    }

    function linkQueries(): LinkQuery[] {
      return (prisma.calendarEventLink.findMany.mock.calls as LinkQuery[][])
        .map((call) => call[0])
        .filter((query) => query.where.syncStatus === 'FAILED');
    }

    beforeEach(() => {
      prisma.googleCalendarConnection.findMany.mockResolvedValue([
        buildConnection(),
      ]);
      prisma.consultation.findMany.mockResolvedValue([]);
    });

    it('repairFailedLinks recorre todas las páginas con orden por id y keyset tras la última fila', async () => {
      const failedPages = [
        pageOf(RECONCILE_BATCH_LIMIT, 0, 'FAILED'),
        pageOf(RECONCILE_BATCH_LIMIT, RECONCILE_BATCH_LIMIT, 'FAILED'),
        pageOf(50, 2 * RECONCILE_BATCH_LIMIT, 'FAILED'),
      ];
      let failedCall = 0;
      prisma.calendarEventLink.findMany.mockImplementation((args: LinkQuery) =>
        Promise.resolve(
          args.where.syncStatus === 'FAILED'
            ? (failedPages[failedCall++] ?? [])
            : [],
        ),
      );
      const syncGroup = jest.spyOn(service, 'syncGroup').mockResolvedValue();

      await service.reconcile();

      const queries = linkQueries();
      expect(queries).toHaveLength(3);
      expect(queries.every((q) => q.orderBy.id === 'asc')).toBe(true);
      expect(queries[0].where.id).toBeUndefined();
      expect(queries[1].where.id).toEqual({ gt: 'link-00199' });
      expect(queries[2].where.id).toEqual({ gt: 'link-00399' });
      // Se repararon los 450 links, no solo los primeros 200.
      expect(syncGroup).toHaveBeenCalledTimes(450);
      expect(syncGroup).toHaveBeenCalledWith('group-00449');
    });

    it('deleteForRemovedConsultations alcanza los links de la segunda página', async () => {
      const allPages = [
        pageOf(RECONCILE_BATCH_LIMIT, 0, 'SYNCED'),
        [linkRow(RECONCILE_BATCH_LIMIT, 'SYNCED')],
      ];
      let call = 0;
      prisma.calendarEventLink.findMany.mockImplementation(
        (args: LinkQuery) => {
          if (args.where.syncStatus) return Promise.resolve([]);
          return Promise.resolve(allPages[call++] ?? []);
        },
      );
      // Ninguna consulta existe => todos los links se consideran huérfanos.
      prisma.consultation.findMany.mockResolvedValue([]);
      prisma.calendarEventLink.findUnique.mockImplementation(
        (args: { where: { connectionId_groupId: { groupId: string } } }) =>
          Promise.resolve({
            id: `link-of-${args.where.connectionId_groupId.groupId}`,
            googleEventId: 'event',
          }),
      );
      googleCalendarClient.deleteEvent.mockResolvedValue(undefined);

      await service.reconcile();

      expect(googleCalendarClient.deleteEvent).toHaveBeenCalledTimes(
        RECONCILE_BATCH_LIMIT + 1,
      );
    });

    it('backfill pagina las consultas con cursor y solo sincroniza las que no tienen link', async () => {
      const candidate = (i: number) => ({
        id: `consultation-${String(i).padStart(5, '0')}`,
        groupId: `group-${String(i).padStart(5, '0')}`,
      });
      const page1 = Array.from({ length: RECONCILE_BATCH_LIMIT }, (_, i) =>
        candidate(i),
      );
      const page2 = [candidate(RECONCILE_BATCH_LIMIT)];
      prisma.calendarEventLink.findMany.mockImplementation(
        (args: {
          where: { groupId?: { in: string[] }; syncStatus?: string };
        }) => {
          // Solo la consulta de links del backfill filtra por groupId in [...].
          if (args.where.groupId) {
            return Promise.resolve(
              args.where.groupId.in
                .filter((g) => page1.some((c) => c.groupId === g))
                .map((groupId) => ({ groupId })),
            );
          }
          return Promise.resolve([]);
        },
      );
      let consultationCall = 0;
      const consultationPages = [page1, page2];
      prisma.consultation.findMany.mockImplementation(
        (args: { select?: { id?: boolean; groupId?: boolean } }) =>
          Promise.resolve(
            args.select?.id
              ? (consultationPages[consultationCall++] ?? [])
              : [],
          ),
      );
      const syncGroup = jest.spyOn(service, 'syncGroup').mockResolvedValue();

      await service.reconcile();

      const backfillQueries = (
        prisma.consultation.findMany.mock.calls as {
          select?: { id?: boolean };
          orderBy?: unknown;
          cursor?: unknown;
          skip?: number;
        }[][]
      )
        .map((c) => c[0])
        .filter((q) => q.select?.id);
      expect(backfillQueries).toHaveLength(2);
      expect(backfillQueries[0].orderBy).toEqual([
        { sessionDate: 'asc' },
        { id: 'asc' },
      ]);
      expect(backfillQueries[0].cursor).toBeUndefined();
      expect(backfillQueries[1].cursor).toEqual({ id: 'consultation-00199' });
      expect(backfillQueries[1].skip).toBe(1);
      // La página 1 ya estaba enlazada; solo la de la página 2 se sincroniza.
      expect(syncGroup).toHaveBeenCalledTimes(1);
      expect(syncGroup).toHaveBeenCalledWith('group-00200');
    });

    it('detiene el recorrido en MAX_RECONCILE_PAGES aunque siempre haya otra página', async () => {
      prisma.calendarEventLink.findMany.mockImplementation((args: LinkQuery) =>
        Promise.resolve(
          args.where.syncStatus === 'FAILED'
            ? pageOf(RECONCILE_BATCH_LIMIT, 0, 'FAILED')
            : [],
        ),
      );
      jest.spyOn(service, 'syncGroup').mockResolvedValue();
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await service.reconcile();

      expect(linkQueries()).toHaveLength(MAX_RECONCILE_PAGES);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('repairFailedLinks'),
      );
      warn.mockRestore();
    });
  });

  describe('reconcile — aislamiento por conexión (issue #497)', () => {
    type Reconcilable = { reconcileConnection: (c: unknown) => Promise<void> };

    it('un error en una conexión se loguea y no corta el ciclo de las demás', async () => {
      prisma.googleCalendarConnection.findMany.mockResolvedValue([
        buildConnection({ id: 'connection-1', therapistId: 'therapist-1' }),
        buildConnection({ id: 'connection-2', therapistId: 'therapist-2' }),
        buildConnection({ id: 'connection-3', therapistId: 'therapist-3' }),
      ]);
      const reconcileConnection = jest
        .spyOn(service as unknown as Reconcilable, 'reconcileConnection')
        .mockRejectedValueOnce(new Error('prisma caído para esta conexión'))
        .mockResolvedValue(undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.reconcile()).resolves.toBeUndefined();

      expect(reconcileConnection).toHaveBeenCalledTimes(3);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('therapistId=therapist-1'),
      );
      errorSpy.mockRestore();
    });

    it('libera el guard de reentrada tras un error aislado en una conexión', async () => {
      prisma.googleCalendarConnection.findMany.mockResolvedValue([
        buildConnection(),
      ]);
      jest
        .spyOn(service as unknown as Reconcilable, 'reconcileConnection')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await service.reconcile();
      await service.reconcile();

      expect(prisma.googleCalendarConnection.findMany).toHaveBeenCalledTimes(2);
      errorSpy.mockRestore();
    });
  });

  describe('reconcile — guard de reentrada (issue #286)', () => {
    it('omite un tick que llega mientras el anterior sigue en curso y permite el siguiente al terminar', async () => {
      let release!: () => void;
      const blocked = new Promise<unknown[]>((resolve) => {
        release = () => resolve([]);
      });
      prisma.googleCalendarConnection.findMany
        .mockReturnValueOnce(blocked)
        .mockResolvedValue([]);

      const first = service.reconcile();
      await service.reconcile();

      expect(prisma.googleCalendarConnection.findMany).toHaveBeenCalledTimes(1);

      release();
      await first;
      await service.reconcile();

      expect(prisma.googleCalendarConnection.findMany).toHaveBeenCalledTimes(2);
    });

    it('libera el guard aunque el tick falle', async () => {
      prisma.googleCalendarConnection.findMany
        .mockRejectedValueOnce(new Error('db caída'))
        .mockResolvedValue([]);

      await expect(service.reconcile()).rejects.toThrow('db caída');
      await service.reconcile();

      expect(prisma.googleCalendarConnection.findMany).toHaveBeenCalledTimes(2);
    });
  });
});

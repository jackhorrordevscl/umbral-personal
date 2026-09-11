import { ConfigService } from '@nestjs/config';
import { CalendarBusyService } from './calendar-busy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { CalendarSyncService } from './calendar-sync.service';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from './google-calendar.client';

// sdd/public-booking-payment-calendar PR 2 (design.md Decision 3/4, tasks.md
// 2.1/2.4): capa de aplicación de CalendarBusyService con
// Prisma/GoogleCalendarClient/CalendarSyncService/AvailabilityService
// mockeados -- mismo criterio que calendar-sync.service.spec.ts. Cubre el
// reemplazo transaccional de CalendarBusyBlock, la invalidación del cache de
// slots, el ruteo de invalid_grant a CalendarSyncService.handleInvalidGrant,
// y que el job nunca throwea (ni con invalid_grant ni con un error
// genérico/transient), procesando cada conexión de forma aislada.
function buildConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'connection-1',
    therapistId: 'therapist-1',
    status: 'CONNECTED',
    calendarId: 'primary',
    ...overrides,
  };
}

describe('CalendarBusyService', () => {
  let prisma: {
    googleCalendarConnection: { findMany: jest.Mock; update: jest.Mock };
    calendarBusyBlock: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let googleCalendarClient: { listBusyIntervals: jest.Mock };
  let calendarSyncService: {
    buildOAuth2Client: jest.Mock;
    handleInvalidGrant: jest.Mock;
  };
  let availabilityService: { invalidate: jest.Mock };
  let config: { get: jest.Mock };

  function buildService(): CalendarBusyService {
    return new CalendarBusyService(
      prisma as unknown as PrismaService,
      googleCalendarClient as unknown as GoogleCalendarClient,
      calendarSyncService as unknown as CalendarSyncService,
      availabilityService as unknown as AvailabilityService,
      config as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    prisma = {
      googleCalendarConnection: {
        findMany: jest.fn().mockResolvedValue([buildConnection()]),
        update: jest.fn().mockResolvedValue({}),
      },
      calendarBusyBlock: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) =>
        Promise.all(ops as Promise<unknown>[]),
      ),
    };
    googleCalendarClient = {
      listBusyIntervals: jest.fn().mockResolvedValue([]),
    };
    calendarSyncService = {
      buildOAuth2Client: jest.fn().mockReturnValue({}),
      handleInvalidGrant: jest.fn().mockResolvedValue(undefined),
    };
    availabilityService = { invalidate: jest.fn() };
    config = {
      get: jest.fn((key: string) =>
        key === 'CALENDAR_AVAILABILITY_OVERLAY_ENABLED' ? 'true' : undefined,
      ),
    };
  });

  it('reemplaza los CalendarBusyBlock del terapeuta en una transacción e invalida su cache tras un refresh exitoso', async () => {
    const intervals = [
      {
        startsAt: new Date('2026-06-01T13:00:00.000Z'),
        endsAt: new Date('2026-06-01T14:00:00.000Z'),
      },
    ];
    googleCalendarClient.listBusyIntervals.mockResolvedValue(intervals);
    const service = buildService();

    await service.refresh();

    expect(prisma.calendarBusyBlock.deleteMany).toHaveBeenCalledWith({
      where: { therapistId: 'therapist-1' },
    });
    expect(prisma.calendarBusyBlock.createMany).toHaveBeenCalledWith({
      data: [
        {
          therapistId: 'therapist-1',
          startsAt: intervals[0].startsAt,
          endsAt: intervals[0].endsAt,
        },
      ],
    });
    expect(prisma.googleCalendarConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: {
        busySyncedAt: expect.any(Date) as unknown as Date,
        busySyncError: null,
      },
    });
    expect(availabilityService.invalidate).toHaveBeenCalledWith('therapist-1');
  });

  it('no consulta conexiones ni llama a Google cuando el flag está apagado', async () => {
    config.get = jest.fn().mockReturnValue(undefined);
    const service = buildService();

    await service.refresh();

    expect(prisma.googleCalendarConnection.findMany).not.toHaveBeenCalled();
    expect(googleCalendarClient.listBusyIntervals).not.toHaveBeenCalled();
  });

  it('invalid_grant enruta a CalendarSyncService.handleInvalidGrant y el job resuelve sin throwear', async () => {
    googleCalendarClient.listBusyIntervals.mockRejectedValue(
      new GoogleCalendarError('invalid_grant', 'token revocado'),
    );
    const service = buildService();

    await expect(service.refresh()).resolves.toBeUndefined();

    expect(calendarSyncService.handleInvalidGrant).toHaveBeenCalledWith(
      'connection-1',
    );
    expect(prisma.calendarBusyBlock.deleteMany).not.toHaveBeenCalled();
    expect(availabilityService.invalidate).not.toHaveBeenCalled();
  });

  // Triangulación: una falla que NO es GoogleCalendarError('invalid_grant')
  // (p. ej. un error de red genérico) nunca debe escapar refresh() -- se
  // loguea y se marca busySyncError, pero el job igual resuelve.
  it('un error transient/genérico se loguea y marca busySyncError sin propagarse', async () => {
    googleCalendarClient.listBusyIntervals.mockRejectedValue(
      new Error('ECONNRESET'),
    );
    const service = buildService();

    await expect(service.refresh()).resolves.toBeUndefined();

    expect(calendarSyncService.handleInvalidGrant).not.toHaveBeenCalled();
    expect(prisma.googleCalendarConnection.update).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: { busySyncError: 'ECONNRESET' },
    });
  });

  it('procesa cada conexión de forma aislada: una conexión con invalid_grant no frena el resto del batch', async () => {
    prisma.googleCalendarConnection.findMany.mockResolvedValue([
      buildConnection({ id: 'connection-1', therapistId: 'therapist-1' }),
      buildConnection({ id: 'connection-2', therapistId: 'therapist-2' }),
    ]);
    googleCalendarClient.listBusyIntervals
      .mockRejectedValueOnce(
        new GoogleCalendarError('invalid_grant', 'token revocado'),
      )
      .mockResolvedValueOnce([]);
    const service = buildService();

    await service.refresh();

    expect(calendarSyncService.handleInvalidGrant).toHaveBeenCalledWith(
      'connection-1',
    );
    expect(availabilityService.invalidate).toHaveBeenCalledWith('therapist-2');
    expect(availabilityService.invalidate).not.toHaveBeenCalledWith(
      'therapist-1',
    );
  });
});

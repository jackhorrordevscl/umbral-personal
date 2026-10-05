import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NOTIFICATIONS_PURGE_BATCH_SIZE,
  NOTIFICATIONS_PURGE_DEFAULT_MAX_BATCHES,
  NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS,
  NotificationsPurgeService,
} from './notifications-purge.service';

// Issue #290: purga diaria de notificaciones leídas antiguas.

const DAY_MS = 24 * 60 * 60 * 1000;

function buildRows(count: number, prefix = 'n') {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));
}

describe('NotificationsPurgeService', () => {
  let prisma: {
    notification: { findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let config: { get: jest.Mock };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  function buildService(
    env: Record<string, string | undefined> = {},
  ): NotificationsPurgeService {
    config = {
      get: jest.fn((key: string) => env[key]),
    };
    return new NotificationsPurgeService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: { id: { in: string[] } } }) =>
              Promise.resolve({ count: where.id.in.length }),
          ),
      },
    };
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('no hace nada cuando NOTIFICATIONS_PURGE_ENABLED es "false"', async () => {
    const service = buildService({ NOTIFICATIONS_PURGE_ENABLED: 'false' });

    await service.purge();

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  it('queda habilitado cuando NOTIFICATIONS_PURGE_ENABLED está ausente', async () => {
    const service = buildService();

    await service.purge();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(1);
  });

  it('solo purga notificaciones leídas hace más que la retención por defecto', async () => {
    prisma.notification.findMany.mockResolvedValueOnce(buildRows(3));
    const service = buildService();
    const before = Date.now();

    await service.purge();

    const where = (
      prisma.notification.findMany.mock.calls[0] as [
        { where: { readAt: { lt: Date } } },
      ]
    )[0].where;
    const cutoff = where.readAt.lt.getTime();
    const retentionMs = NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS * DAY_MS;
    expect(cutoff).toBeGreaterThanOrEqual(before - retentionMs);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - retentionMs);
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['n-0', 'n-1', 'n-2'] } },
    });
  });

  it('respeta NOTIFICATIONS_PURGE_RETENTION_DAYS', async () => {
    const service = buildService({ NOTIFICATIONS_PURGE_RETENTION_DAYS: '90' });
    const before = Date.now();

    await service.purge();

    const where = (
      prisma.notification.findMany.mock.calls[0] as [
        { where: { readAt: { lt: Date } } },
      ]
    )[0].where;
    expect(where.readAt.lt.getTime()).toBeGreaterThanOrEqual(
      before - 90 * DAY_MS,
    );
    expect(where.readAt.lt.getTime()).toBeLessThanOrEqual(
      Date.now() - 90 * DAY_MS,
    );
  });

  it('usa la retención por defecto si NOTIFICATIONS_PURGE_RETENTION_DAYS es inválido', async () => {
    const service = buildService({ NOTIFICATIONS_PURGE_RETENTION_DAYS: 'abc' });
    const before = Date.now();

    await service.purge();

    const where = (
      prisma.notification.findMany.mock.calls[0] as [
        { where: { readAt: { lt: Date } } },
      ]
    )[0].where;
    expect(where.readAt.lt.getTime()).toBeGreaterThanOrEqual(
      before - NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS * DAY_MS,
    );
  });

  it('no llama a deleteMany cuando no hay notificaciones para purgar', async () => {
    const service = buildService();

    await service.purge();

    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  it('elimina en lotes y se detiene cuando un lote viene incompleto', async () => {
    prisma.notification.findMany
      .mockResolvedValueOnce(buildRows(NOTIFICATIONS_PURGE_BATCH_SIZE, 'a'))
      .mockResolvedValueOnce(buildRows(10, 'b'));
    const service = buildService();

    await service.purge();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: NOTIFICATIONS_PURGE_BATCH_SIZE }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`${NOTIFICATIONS_PURGE_BATCH_SIZE + 10} filas`),
    );
  });

  it('respeta el tope máximo de lotes por corrida', async () => {
    prisma.notification.findMany.mockResolvedValue(
      buildRows(NOTIFICATIONS_PURGE_BATCH_SIZE),
    );
    const service = buildService();

    await service.purge();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(
      NOTIFICATIONS_PURGE_DEFAULT_MAX_BATCHES,
    );
  });

  it('respeta NOTIFICATIONS_PURGE_MAX_BATCHES', async () => {
    prisma.notification.findMany.mockResolvedValue(
      buildRows(NOTIFICATIONS_PURGE_BATCH_SIZE),
    );
    const service = buildService({ NOTIFICATIONS_PURGE_MAX_BATCHES: '3' });

    await service.purge();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(3);
  });

  it('registra el error y no lo propaga cuando la base de datos falla', async () => {
    prisma.notification.findMany.mockRejectedValue(new Error('db caída'));
    const service = buildService();

    await expect(service.purge()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db caída'));
  });

  it('libera el guard de reentrada tras un error y permite la siguiente corrida', async () => {
    prisma.notification.findMany
      .mockRejectedValueOnce(new Error('db caída'))
      .mockResolvedValueOnce([]);
    const service = buildService();

    await service.purge();
    await service.purge();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(2);
  });

  it('omite la corrida si la anterior sigue en curso', async () => {
    let release!: (rows: unknown[]) => void;
    prisma.notification.findMany.mockReturnValueOnce(
      new Promise<unknown[]>((resolve) => {
        release = resolve;
      }),
    );
    const service = buildService();

    const first = service.purge();
    await service.purge();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('omitida'));

    release([]);
    await first;
  });
});

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NOTIFICATIONS_PURGE_BATCH_SIZE,
  NOTIFICATIONS_PURGE_DEFAULT_MAX_BATCHES,
  NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS,
  NOTIFICATIONS_PURGE_DEFAULT_UNREAD_RETENTION_DAYS,
  NotificationsPurgeService,
} from './notifications-purge.service';

// Issue #290: purga diaria de notificaciones leídas antiguas. Issue #501 (A4):
// también las no leídas, con una retención propia.

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

  // Cortes que usó la primera consulta de la corrida: el de las leídas
  // (readAt) y el de las no leídas (createdAt).
  function cutoffsOfFirstQuery() {
    const where = (
      prisma.notification.findMany.mock.calls[0] as [
        {
          where: {
            OR: [
              { readAt: { lt: Date } },
              { readAt: null; createdAt: { lt: Date } },
            ];
          };
        },
      ]
    )[0].where;
    return {
      read: where.OR[0].readAt.lt.getTime(),
      unread: where.OR[1].createdAt.lt.getTime(),
      unreadOnlyWhenNeverRead: where.OR[1].readAt === null,
    };
  }

  it('purga las leídas hace más que la retención por defecto', async () => {
    prisma.notification.findMany.mockResolvedValueOnce(buildRows(3));
    const service = buildService();
    const before = Date.now();

    await service.purge();

    const { read } = cutoffsOfFirstQuery();
    const retentionMs = NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS * DAY_MS;
    expect(read).toBeGreaterThanOrEqual(before - retentionMs);
    expect(read).toBeLessThanOrEqual(Date.now() - retentionMs);
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['n-0', 'n-1', 'n-2'] } },
    });
  });

  it('purga también las no leídas creadas hace más que la retención por defecto de no leídas (A4 de #501)', async () => {
    const service = buildService();
    const before = Date.now();

    await service.purge();

    const { unread, unreadOnlyWhenNeverRead } = cutoffsOfFirstQuery();
    const retentionMs =
      NOTIFICATIONS_PURGE_DEFAULT_UNREAD_RETENTION_DAYS * DAY_MS;
    expect(unreadOnlyWhenNeverRead).toBe(true);
    expect(unread).toBeGreaterThanOrEqual(before - retentionMs);
    expect(unread).toBeLessThanOrEqual(Date.now() - retentionMs);
  });

  it('respeta NOTIFICATIONS_PURGE_RETENTION_DAYS sin mover el corte de las no leídas', async () => {
    const service = buildService({ NOTIFICATIONS_PURGE_RETENTION_DAYS: '10' });
    const before = Date.now();

    await service.purge();

    const { read, unread } = cutoffsOfFirstQuery();
    expect(read).toBeGreaterThanOrEqual(before - 10 * DAY_MS);
    expect(read).toBeLessThanOrEqual(Date.now() - 10 * DAY_MS);
    expect(unread).toBeLessThanOrEqual(
      Date.now() - NOTIFICATIONS_PURGE_DEFAULT_UNREAD_RETENTION_DAYS * DAY_MS,
    );
  });

  it('respeta NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS', async () => {
    const service = buildService({
      NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS: '45',
    });
    const before = Date.now();

    await service.purge();

    const { unread } = cutoffsOfFirstQuery();
    expect(unread).toBeGreaterThanOrEqual(before - 45 * DAY_MS);
    expect(unread).toBeLessThanOrEqual(Date.now() - 45 * DAY_MS);
  });

  it('usa los valores por defecto si las retenciones son inválidas', async () => {
    const service = buildService({
      NOTIFICATIONS_PURGE_RETENTION_DAYS: 'abc',
      NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS: '-5',
    });
    const before = Date.now();

    await service.purge();

    const { read, unread } = cutoffsOfFirstQuery();
    expect(read).toBeGreaterThanOrEqual(
      before - NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS * DAY_MS,
    );
    expect(unread).toBeGreaterThanOrEqual(
      before - NOTIFICATIONS_PURGE_DEFAULT_UNREAD_RETENTION_DAYS * DAY_MS,
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

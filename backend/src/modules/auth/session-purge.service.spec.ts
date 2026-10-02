import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SESSION_PURGE_BATCH_SIZE,
  SESSION_PURGE_GRACE_MS,
  SESSION_PURGE_MAX_BATCHES,
  SessionPurgeService,
} from './session-purge.service';

// Issue #287: purga diaria de sesiones expiradas/revocadas.

function buildRows(count: number, prefix = 's') {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));
}

describe('SessionPurgeService', () => {
  let prisma: {
    session: { findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let config: { get: jest.Mock };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  function buildService(enabled = true): SessionPurgeService {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'SESSION_PURGE_ENABLED')
          return enabled ? undefined : 'false';
        return undefined;
      }),
    };
    return new SessionPurgeService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    prisma = {
      session: {
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

  it('no hace nada cuando SESSION_PURGE_ENABLED es "false"', async () => {
    const service = buildService(false);

    await service.purge();

    expect(prisma.session.findMany).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it('queda habilitado cuando SESSION_PURGE_ENABLED está ausente', async () => {
    const service = buildService(true);

    await service.purge();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(1);
  });

  it('elimina las sesiones expiradas o revocadas hace más que el margen de gracia', async () => {
    prisma.session.findMany.mockResolvedValueOnce(buildRows(3));
    const service = buildService();
    const before = Date.now();

    await service.purge();

    const where = (
      prisma.session.findMany.mock.calls[0] as [
        {
          where: {
            OR: [{ expiresAt: { lt: Date } }, { revokedAt: { lt: Date } }];
          };
        },
      ]
    )[0].where;
    const cutoff = where.OR[0].expiresAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - SESSION_PURGE_GRACE_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - SESSION_PURGE_GRACE_MS);
    expect(where.OR[1].revokedAt.lt.getTime()).toBe(cutoff);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-0', 's-1', 's-2'] } },
    });
  });

  it('no llama a deleteMany cuando no hay sesiones para purgar', async () => {
    const service = buildService();

    await service.purge();

    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it('elimina en lotes y se detiene cuando un lote viene incompleto', async () => {
    prisma.session.findMany
      .mockResolvedValueOnce(buildRows(SESSION_PURGE_BATCH_SIZE, 'a'))
      .mockResolvedValueOnce(buildRows(SESSION_PURGE_BATCH_SIZE, 'b'))
      .mockResolvedValueOnce(buildRows(10, 'c'));
    const service = buildService();

    await service.purge();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.session.deleteMany).toHaveBeenCalledTimes(3);
    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: SESSION_PURGE_BATCH_SIZE }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`${SESSION_PURGE_BATCH_SIZE * 2 + 10} filas`),
    );
  });

  it('respeta el tope máximo de lotes por corrida', async () => {
    prisma.session.findMany.mockResolvedValue(
      buildRows(SESSION_PURGE_BATCH_SIZE),
    );
    const service = buildService();

    await service.purge();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(
      SESSION_PURGE_MAX_BATCHES,
    );
    expect(prisma.session.deleteMany).toHaveBeenCalledTimes(
      SESSION_PURGE_MAX_BATCHES,
    );
  });

  it('registra el error y no lo propaga cuando la base de datos falla', async () => {
    prisma.session.findMany.mockRejectedValue(new Error('db caída'));
    const service = buildService();

    await expect(service.purge()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db caída'));
  });

  it('libera el guard de reentrada tras un error y permite la siguiente corrida', async () => {
    prisma.session.findMany
      .mockRejectedValueOnce(new Error('db caída'))
      .mockResolvedValueOnce([]);
    const service = buildService();

    await service.purge();
    await service.purge();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(2);
  });

  it('omite la corrida si la anterior sigue en curso', async () => {
    let release!: (rows: unknown[]) => void;
    prisma.session.findMany.mockReturnValueOnce(
      new Promise<unknown[]>((resolve) => {
        release = resolve;
      }),
    );
    const service = buildService();

    const first = service.purge();
    await service.purge();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('omitida'));

    release([]);
    await first;
  });
});

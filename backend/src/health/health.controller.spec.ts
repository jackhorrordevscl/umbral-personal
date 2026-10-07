import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('responde ok cuando la base contesta', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('responde 503 sin filtrar el detalle cuando la base falla', async () => {
    queryRaw.mockRejectedValue(new Error('password authentication failed'));

    const result = controller.check();

    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toMatchObject({
      response: { status: 'error' },
    });
    await expect(result).rejects.not.toThrow(/password/);
  });

  it('responde 503 si la base no contesta a tiempo', async () => {
    jest.useFakeTimers();
    try {
      queryRaw.mockReturnValue(new Promise(() => undefined));

      const result = controller.check();
      const assertion = expect(result).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

import { ThrottlerException } from '@nestjs/throttler';
import { MfaAttemptLimiter } from './mfa-attempt-limiter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const MIN = 60 * 1000;

describe('MfaAttemptLimiter', () => {
  let limiter: MfaAttemptLimiter;
  let prisma: {
    user: { update: jest.Mock; updateMany: jest.Mock };
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = {
      user: {
        update: jest.fn().mockResolvedValue({ mfaFailedAttempts: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    limiter = new MfaAttemptLimiter(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const user = { id: 'user-1', mfaLockedUntil: null as Date | null };

  describe('reserve', () => {
    it('reserva un intento con un incremento atómico y deja pasar mientras no se pase el tope', async () => {
      for (const attempts of [1, 2, 3, 4, 5]) {
        prisma.user.update.mockResolvedValueOnce({
          mfaFailedAttempts: attempts,
        });
        await expect(limiter.reserve(user)).resolves.toBeUndefined();
      }

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaFailedAttempts: { increment: 1 }, mfaFailedAt: NOW },
        select: { mfaFailedAttempts: true },
      });
      // Solo la limpieza de la ventana: ningún intento escribió un bloqueo.
      expect(prisma.user.updateMany).toHaveBeenCalledTimes(5);
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('descarta primero los intentos más viejos que la ventana', async () => {
      await limiter.reserve(user);

      expect(prisma.user.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: 'user-1',
          mfaFailedAt: { lt: new Date(NOW.getTime() - 60 * MIN) },
        },
        data: {
          mfaFailedAttempts: 0,
          mfaFailedAt: null,
          mfaLockedUntil: null,
        },
      });
    });

    it.each([
      [6, 1],
      [7, 5],
      [8, 15],
      [9, 60],
      [20, 60],
    ])(
      'con %i intentos reservados deja pasar este intento y arma un bloqueo de %i min',
      async (attempts, minutes) => {
        prisma.user.update.mockResolvedValue({ mfaFailedAttempts: attempts });
        const lockedUntil = new Date(NOW.getTime() + minutes * MIN);

        await expect(
          limiter.reserve(user, '203.0.113.7', 'jest-agent'),
        ).resolves.toBeUndefined();

        expect(prisma.user.updateMany).toHaveBeenLastCalledWith({
          where: {
            id: 'user-1',
            OR: [{ mfaLockedUntil: null }, { mfaLockedUntil: { lte: NOW } }],
          },
          data: { mfaLockedUntil: lockedUntil },
        });
        expect(auditService.log).toHaveBeenCalledWith({
          userId: 'user-1',
          action: 'MFA_FAILED',
          resource: 'MFA',
          resourceId: 'user-1',
          detail: `Bloqueo de ${minutes} min armado por intentos de segundo factor`,
          ipAddress: '203.0.113.7',
          userAgent: 'jest-agent',
        });
      },
    );

    it('responde 429 sin reservar ni escribir nada mientras la cuenta sigue bloqueada', async () => {
      const locked = {
        id: 'user-1',
        mfaLockedUntil: new Date(NOW.getTime() + MIN),
      };

      await expect(limiter.reserve(locked)).rejects.toBeInstanceOf(
        ThrottlerException,
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('un bloqueo ya vencido no frena el intento: se reserva con normalidad', async () => {
      const expired = {
        id: 'user-1',
        mfaLockedUntil: new Date(NOW.getTime() - 1),
      };
      prisma.user.update.mockResolvedValue({ mfaFailedAttempts: 3 });

      await expect(limiter.reserve(expired)).resolves.toBeUndefined();
    });

    it('pasado el tope, si otra petición ya armó el bloqueo responde 429 y no audita', async () => {
      prisma.user.update.mockResolvedValue({ mfaFailedAttempts: 9 });
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(limiter.reserve(user)).rejects.toBeInstanceOf(
        ThrottlerException,
      );

      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('si falla el registro en auditoría el intento igual procede', async () => {
      prisma.user.update.mockResolvedValue({ mfaFailedAttempts: 6 });
      auditService.log.mockRejectedValue(new Error('audit down'));

      await expect(limiter.reserve(user)).resolves.toBeUndefined();
    });
  });

  describe('clear', () => {
    it('pone en cero el contador y las fechas de la cuenta', async () => {
      await limiter.clear('user-1');

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          mfaFailedAttempts: 0,
          mfaFailedAt: null,
          mfaLockedUntil: null,
        },
      });
    });
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';

interface StrategyUser {
  id: string;
  email: string;
  role: string;
  name: string;
  deletedAt: Date | null;
  passwordChangedAt: Date | null;
}

function buildUser(overrides: Partial<StrategyUser> = {}): StrategyUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role: 'PROFESSIONAL',
    name: 'Test User',
    deletedAt: null,
    passwordChangedAt: null,
    ...overrides,
  };
}

const basePayload = {
  sub: 'user-1',
  email: 'user@example.com',
  role: 'PROFESSIONAL',
};

/**
 * Issue #76 (PR B): JwtStrategy.validate() rechaza cualquier Bearer token
 * cuyo `iat` sea anterior a `User.passwordChangedAt` (piso en segundos, sin
 * tolerancia de clock-skew -- ver design.md). Una columna NULL (usuario
 * pre-deploy o que nunca cambió su contraseña) desactiva el chequeo por
 * completo, sin forzar ningún logout retroactivo.
 */
describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    configService = { get: jest.fn().mockReturnValue('test-jwt-secret') };

    strategy = new JwtStrategy(
      configService as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );

    jest.clearAllMocks();
  });

  describe('purpose blocklist (regresión previa a este cambio)', () => {
    it('rechaza un purpose bloqueado (password-change) sin siquiera consultar prisma', async () => {
      await expect(
        strategy.validate({
          ...basePayload,
          purpose: 'password-change',
          iat: 1000,
        }),
      ).rejects.toThrow('Token no autorizado para esta operación');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('usuario inexistente o soft-deleted (regresión)', () => {
    it('rechaza (401) si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        strategy.validate({ ...basePayload, iat: 1000 }),
      ).rejects.toThrow('Usuario no autorizado');
    });

    it('rechaza (401) si el usuario está soft-deleted', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ deletedAt: new Date() }),
      );

      await expect(
        strategy.validate({ ...basePayload, iat: 1000 }),
      ).rejects.toThrow('Usuario no autorizado');
    });
  });

  describe('passwordChangedAt NULL — sin invalidación', () => {
    it('acepta un token con iat arbitrariamente viejo si passwordChangedAt nunca se seteó', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordChangedAt: null }),
      );

      const result = await strategy.validate({ ...basePayload, iat: 1 });

      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.com',
        role: 'PROFESSIONAL',
        name: 'Test User',
      });
    });
  });

  describe('passwordChangedAt seteado — invalidación por iat', () => {
    it('rechaza (401) un token cuyo iat es 1 segundo anterior a passwordChangedAt', async () => {
      const changedAt = new Date('2026-01-01T00:00:10.000Z');
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordChangedAt: changedAt }),
      );
      const iatOneSecondBefore = Math.floor(changedAt.getTime() / 1000) - 1;

      await expect(
        strategy.validate({ ...basePayload, iat: iatOneSecondBefore }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('acepta un token cuyo iat es exactamente igual (piso) a passwordChangedAt -- el token recién emitido en ese cambio no se autorrechaza', async () => {
      const changedAt = new Date('2026-01-01T00:00:10.500Z');
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordChangedAt: changedAt }),
      );
      const iatSameSecond = Math.floor(changedAt.getTime() / 1000);

      const result = await strategy.validate({
        ...basePayload,
        iat: iatSameSecond,
      });

      expect(result.id).toBe('user-1');
    });

    it('acepta un token con iat posterior al cambio', async () => {
      const changedAt = new Date('2026-01-01T00:00:10.000Z');
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordChangedAt: changedAt }),
      );
      const iatAfter = Math.floor(changedAt.getTime() / 1000) + 5;

      const result = await strategy.validate({ ...basePayload, iat: iatAfter });

      expect(result.id).toBe('user-1');
    });
  });
});

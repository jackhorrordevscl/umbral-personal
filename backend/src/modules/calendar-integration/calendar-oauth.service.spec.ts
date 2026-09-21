import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CalendarOauthService } from './calendar-oauth.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OAUTH_STATE_PURPOSE } from './calendar-integration.constants';

function buildAuditServiceMock(): {
  auditService: AuditService;
  logMock: jest.Mock;
} {
  const logMock = jest.fn().mockResolvedValue(undefined);
  return { auditService: { log: logMock } as unknown as AuditService, logMock };
}

const JWT_SECRET = 'test-jwt-secret-for-calendar-oauth-spec';

function buildJwt(): JwtService {
  return new JwtService({ secret: JWT_SECRET });
}

function buildConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    JWT_SECRET,
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI:
      'http://localhost:3001/api/v1/calendar-integration/callback',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

interface PrismaConnectionMock {
  findUnique: jest.Mock<Promise<unknown>, unknown[]>;
  upsert: jest.Mock<Promise<unknown>, unknown[]>;
  update: jest.Mock<Promise<unknown>, unknown[]>;
  updateMany: jest.Mock<Promise<{ count: number }>, unknown[]>;
}

function buildPrismaMock(): {
  prisma: PrismaService;
  connectionMock: PrismaConnectionMock;
} {
  const connectionMock: PrismaConnectionMock = {
    findUnique: jest.fn<Promise<unknown>, unknown[]>(),
    upsert: jest.fn<Promise<unknown>, unknown[]>(),
    update: jest.fn<Promise<unknown>, unknown[]>(),
    updateMany: jest
      .fn<Promise<{ count: number }>, unknown[]>()
      .mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    googleCalendarConnection: connectionMock,
  } as unknown as PrismaService;

  return { prisma, connectionMock };
}

function buildTokenCrypto(): GoogleTokenCryptoService {
  const key = Buffer.alloc(32, 4).toString('base64');
  const config = { get: () => key } as unknown as ConfigService;
  const service = new GoogleTokenCryptoService(config);
  service.onModuleInit();
  return service;
}

// Reemplaza el OAuth2Client real que buildOAuth2Client() (privado)
// construiría, para interceptar getToken()/revokeToken() sin hablar con
// google-auth-library -- mismo criterio que el spyOn de
// exchangeAuthorizationCode ya usado en este archivo.
function stubOAuth2Client(
  service: CalendarOauthService,
  overrides: { getToken?: jest.Mock; revokeToken?: jest.Mock },
) {
  return jest
    .spyOn(
      service as unknown as { buildOAuth2Client: () => unknown },
      'buildOAuth2Client',
    )
    .mockReturnValue(overrides);
}

describe('CalendarOauthService', () => {
  describe('verifyAndConsumeState', () => {
    const therapistId = 'therapist-1';
    const nonce = 'a-fixed-nonce-value';
    const nonceHash = createHash('sha256').update(nonce).digest('hex');

    function buildService(updateManyResult?: { count: number }) {
      const jwt = buildJwt();
      const { prisma, connectionMock } = buildPrismaMock();
      if (updateManyResult) {
        connectionMock.updateMany.mockResolvedValue(updateManyResult);
      }
      const tokenCrypto = buildTokenCrypto();
      const service = new CalendarOauthService(
        prisma,
        jwt,
        buildConfig(),
        tokenCrypto,
        buildAuditServiceMock().auditService,
      );
      return { service, jwt, connectionMock };
    }

    it('rechaza un state con firma inválida', async () => {
      const { service } = buildService();
      const forgedJwt = new JwtService({ secret: 'clave-incorrecta' });
      const forgedState = forgedJwt.sign({
        sub: therapistId,
        purpose: OAUTH_STATE_PURPOSE,
        nonce,
      });

      await expect(service.verifyAndConsumeState(forgedState)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza un state expirado', async () => {
      const { service, jwt } = buildService();
      const expiredState = jwt.sign(
        { sub: therapistId, purpose: OAUTH_STATE_PURPOSE, nonce },
        { expiresIn: '-1s' },
      );

      await expect(service.verifyAndConsumeState(expiredState)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza un state con purpose incorrecto', async () => {
      const { service, jwt } = buildService();
      const wrongPurposeState = jwt.sign({
        sub: therapistId,
        purpose: 'password-reset',
        nonce,
      });

      await expect(
        service.verifyAndConsumeState(wrongPurposeState),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un nonce ya consumido (replay)', async () => {
      const { service, jwt, connectionMock } = buildService({ count: 0 });
      const state = jwt.sign({
        sub: therapistId,
        purpose: OAUTH_STATE_PURPOSE,
        nonce,
      });

      await expect(service.verifyAndConsumeState(state)).rejects.toThrow(
        UnauthorizedException,
      );
      const callArg = connectionMock.updateMany.mock.calls[0][0] as {
        where: { therapistId: string; stateNonceHash: string };
      };
      expect(callArg.where.therapistId).toBe(therapistId);
      expect(callArg.where.stateNonceHash).toBe(nonceHash);
    });

    it('acepta un state válido, no consumido, y lo limpia atómicamente', async () => {
      const { service, jwt, connectionMock } = buildService({ count: 1 });
      const state = jwt.sign({
        sub: therapistId,
        purpose: OAUTH_STATE_PURPOSE,
        nonce,
      });

      const result = await service.verifyAndConsumeState(state);

      expect(result).toEqual({ therapistId });
      const callArg = connectionMock.updateMany.mock.calls[0][0] as {
        where: {
          therapistId: string;
          stateNonceHash: string;
          stateExpiresAt: { gt: Date };
        };
        data: { stateNonceHash: null; stateExpiresAt: null };
      };
      expect(callArg.where.therapistId).toBe(therapistId);
      expect(callArg.where.stateNonceHash).toBe(nonceHash);
      expect(callArg.where.stateExpiresAt.gt).toBeInstanceOf(Date);
      expect(callArg.data).toEqual({
        stateNonceHash: null,
        stateExpiresAt: null,
      });
    });
  });

  describe('exchangeCodeAndPersist', () => {
    it('persiste el refresh token como ciphertext, nunca en texto plano', async () => {
      const { prisma, connectionMock } = buildPrismaMock();
      connectionMock.update.mockResolvedValue({});
      const tokenCrypto = buildTokenCrypto();
      const { auditService, logMock } = buildAuditServiceMock();
      const service = new CalendarOauthService(
        prisma,
        buildJwt(),
        buildConfig(),
        tokenCrypto,
        auditService,
      );

      const plainRefreshToken = '1//plain-text-refresh-token-google';
      jest
        .spyOn(
          service as unknown as {
            exchangeAuthorizationCode: (
              code: string,
            ) => Promise<{ refreshToken: string; scope?: string }>;
          },
          'exchangeAuthorizationCode',
        )
        .mockResolvedValue({ refreshToken: plainRefreshToken, scope: 'x' });

      await service.exchangeCodeAndPersist('therapist-1', 'auth-code');

      expect(connectionMock.update).toHaveBeenCalledTimes(1);
      const callArg = connectionMock.update.mock.calls[0][0] as {
        data: { refreshTokenEncrypted: Uint8Array };
      };
      const persisted = callArg.data.refreshTokenEncrypted;
      const persistedBuffer = Buffer.from(persisted);

      expect(persisted instanceof Uint8Array).toBe(true);
      // Nunca en claro: el ciphertext no debe contener el texto plano.
      expect(persistedBuffer.includes(Buffer.from(plainRefreshToken))).toBe(
        false,
      );
      // Prueba round-trip real con la misma clave: confirma que es
      // genuinamente el resultado de GoogleTokenCryptoService.encrypt, no
      // cualquier Buffer.
      expect(tokenCrypto.decrypt(persistedBuffer).toString('utf-8')).toBe(
        plainRefreshToken,
      );
      // issue #119: conectar la cuenta debe dejar rastro en AuditLog.
      expect(logMock).toHaveBeenCalledWith({
        userId: 'therapist-1',
        action: 'CALENDAR_CONNECTED',
        resource: 'GoogleCalendarConnection',
        resourceId: 'therapist-1',
      });
    });

    it('rechaza cuando Google no devuelve refresh_token (falta access_type=offline/prompt=consent)', async () => {
      const { prisma } = buildPrismaMock();
      const tokenCrypto = buildTokenCrypto();
      const { auditService, logMock } = buildAuditServiceMock();
      const service = new CalendarOauthService(
        prisma,
        buildJwt(),
        buildConfig(),
        tokenCrypto,
        auditService,
      );
      stubOAuth2Client(service, {
        getToken: jest
          .fn()
          .mockResolvedValue({ tokens: { access_token: 'a', scope: 'x' } }),
      });

      await expect(
        service.exchangeCodeAndPersist('therapist-1', 'auth-code'),
      ).rejects.toThrow(UnauthorizedException);
      // Sin refresh_token no hay nada que persistir ni auditar.
      expect(logMock).not.toHaveBeenCalled();
    });

    it('propaga el error de Google al intercambiar el código (getToken rechaza)', async () => {
      const { prisma } = buildPrismaMock();
      const tokenCrypto = buildTokenCrypto();
      const { auditService, logMock } = buildAuditServiceMock();
      const service = new CalendarOauthService(
        prisma,
        buildJwt(),
        buildConfig(),
        tokenCrypto,
        auditService,
      );
      stubOAuth2Client(service, {
        getToken: jest.fn().mockRejectedValue(new Error('invalid_grant')),
      });

      await expect(
        service.exchangeCodeAndPersist('therapist-1', 'auth-code'),
      ).rejects.toThrow('invalid_grant');
      expect(logMock).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    const therapistId = 'therapist-1';

    function buildService() {
      const { prisma, connectionMock } = buildPrismaMock();
      const tokenCrypto = buildTokenCrypto();
      const { auditService, logMock } = buildAuditServiceMock();
      const service = new CalendarOauthService(
        prisma,
        buildJwt(),
        buildConfig(),
        tokenCrypto,
        auditService,
      );
      return { service, connectionMock, tokenCrypto, logMock };
    }

    it('rechaza si no existe una conexión para el terapeuta', async () => {
      const { service, connectionMock } = buildService();
      connectionMock.findUnique.mockResolvedValue(null);

      await expect(service.disconnect(therapistId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rechaza si la conexión existe pero no está CONNECTED', async () => {
      const { service, connectionMock } = buildService();
      connectionMock.findUnique.mockResolvedValue({
        status: 'DISCONNECTED',
        refreshTokenEncrypted: null,
      });

      await expect(service.disconnect(therapistId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('revoca el token en Google, lo borra localmente y audita (caso feliz)', async () => {
      const { service, connectionMock, tokenCrypto, logMock } = buildService();
      const plainRefreshToken = '1//plain-text-refresh-token-google';
      const encrypted = tokenCrypto.encrypt(
        Buffer.from(plainRefreshToken, 'utf-8'),
      );
      connectionMock.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        refreshTokenEncrypted: Buffer.from(encrypted),
      });
      connectionMock.update.mockResolvedValue({ status: 'DISCONNECTED' });
      const revokeToken = jest.fn().mockResolvedValue(undefined);
      stubOAuth2Client(service, { revokeToken });

      const result = await service.disconnect(therapistId);

      expect(result).toEqual({ status: 'DISCONNECTED' });
      // El token pasado a Google debe ser el texto plano original, nunca el
      // ciphertext -- confirma que se desencriptó antes de revocar.
      expect(revokeToken).toHaveBeenCalledWith(plainRefreshToken);
      const callArg = connectionMock.update.mock.calls[0][0] as {
        data: { status: string; refreshTokenEncrypted: null };
      };
      expect(callArg.data.status).toBe('DISCONNECTED');
      expect(callArg.data.refreshTokenEncrypted).toBeNull();
      expect(logMock).toHaveBeenCalledWith({
        userId: therapistId,
        action: 'CALENDAR_DISCONNECTED',
        resource: 'GoogleCalendarConnection',
        resourceId: therapistId,
        detail: 'USER_REQUEST',
      });
    });

    it('desconecta localmente aunque la revocación en Google falle (best-effort)', async () => {
      const { service, connectionMock, tokenCrypto, logMock } = buildService();
      const encrypted = tokenCrypto.encrypt(
        Buffer.from('1//plain-text-refresh-token-google', 'utf-8'),
      );
      connectionMock.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        refreshTokenEncrypted: Buffer.from(encrypted),
      });
      connectionMock.update.mockResolvedValue({ status: 'DISCONNECTED' });
      const revokeToken = jest
        .fn()
        .mockRejectedValue(new Error('Google ya invalidó el token'));
      stubOAuth2Client(service, { revokeToken });

      const result = await service.disconnect(therapistId);

      // proposal.md "Disconnect": revoke es best-effort -- el borrado local
      // (y la auditoría) deben ocurrir igual aunque Google rechace.
      expect(result).toEqual({ status: 'DISCONNECTED' });
      expect(connectionMock.update).toHaveBeenCalledTimes(1);
      expect(logMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CALENDAR_DISCONNECTED' }),
      );
    });

    it('no intenta revocar en Google si no hay refresh token almacenado', async () => {
      const { service, connectionMock } = buildService();
      connectionMock.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        refreshTokenEncrypted: null,
      });
      connectionMock.update.mockResolvedValue({ status: 'DISCONNECTED' });
      const revokeToken = jest.fn();
      stubOAuth2Client(service, { revokeToken });

      const result = await service.disconnect(therapistId);

      expect(result).toEqual({ status: 'DISCONNECTED' });
      expect(revokeToken).not.toHaveBeenCalled();
    });
  });
});

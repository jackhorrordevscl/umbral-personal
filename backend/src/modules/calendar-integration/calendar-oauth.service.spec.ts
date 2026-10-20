import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CalendarOauthService } from './calendar-oauth.service';
import { GoogleTokenCryptoService } from './google-token-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  GOOGLE_CALENDAR_SCOPE,
  OAUTH_STATE_PURPOSE,
} from './calendar-integration.constants';

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
  busyBlockMock: { deleteMany: jest.Mock };
} {
  const connectionMock: PrismaConnectionMock = {
    findUnique: jest.fn<Promise<unknown>, unknown[]>(),
    upsert: jest.fn<Promise<unknown>, unknown[]>(),
    update: jest.fn<Promise<unknown>, unknown[]>(),
    updateMany: jest
      .fn<Promise<{ count: number }>, unknown[]>()
      .mockResolvedValue({ count: 1 }),
  };
  const busyBlockMock = {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = {
    googleCalendarConnection: connectionMock,
    calendarBusyBlock: busyBlockMock,
  } as unknown as PrismaService;

  return { prisma, connectionMock, busyBlockMock };
}

function buildTokenCrypto(): GoogleTokenCryptoService {
  const key = Buffer.alloc(32, 4).toString('base64');
  const config = {
    get: (name: string) =>
      name === 'GOOGLE_TOKEN_ENCRYPTION_KEY' ? key : undefined,
  } as unknown as ConfigService;
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
    // issue #497: secreto de la cookie del navegador; el state lleva su hash.
    const bindingToken = 'secreto-de-la-cookie-del-navegador';
    const bind = createHash('sha256').update(bindingToken).digest('hex');

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
        bind,
      });

      await expect(
        service.verifyAndConsumeState(forgedState, bindingToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un state expirado', async () => {
      const { service, jwt } = buildService();
      const expiredState = jwt.sign(
        { sub: therapistId, purpose: OAUTH_STATE_PURPOSE, nonce, bind },
        { expiresIn: '-1s' },
      );

      await expect(
        service.verifyAndConsumeState(expiredState, bindingToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un state con purpose incorrecto', async () => {
      const { service, jwt } = buildService();
      const wrongPurposeState = jwt.sign({
        sub: therapistId,
        purpose: 'password-reset',
        nonce,
        bind,
      });

      await expect(
        service.verifyAndConsumeState(wrongPurposeState, bindingToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    // issue #497: el state solo vale en el navegador que inició el flujo.
    describe('atado al navegador (cookie)', () => {
      function signState(payload: Record<string, unknown>, jwt: JwtService) {
        return jwt.sign({
          sub: therapistId,
          purpose: OAUTH_STATE_PURPOSE,
          nonce,
          ...payload,
        });
      }

      it.each([
        ['sin cookie', undefined],
        ['con cookie vacía', ''],
        ['con una cookie de otro navegador', 'secreto-de-otro-navegador'],
      ])(
        'rechaza el callback %s y no consume el nonce',
        async (_label, cookie) => {
          const { service, jwt, connectionMock } = buildService({ count: 1 });
          const state = signState({ bind }, jwt);

          await expect(
            service.verifyAndConsumeState(state, cookie),
          ).rejects.toThrow(UnauthorizedException);
          expect(connectionMock.updateMany).not.toHaveBeenCalled();
        },
      );

      it('rechaza un state sin huella de navegador (emitido antes del cambio)', async () => {
        const { service, jwt, connectionMock } = buildService({ count: 1 });
        const state = signState({}, jwt);

        await expect(
          service.verifyAndConsumeState(state, bindingToken),
        ).rejects.toThrow(UnauthorizedException);
        expect(connectionMock.updateMany).not.toHaveBeenCalled();
      });

      it('rechaza si la huella del state no es un string', async () => {
        const { service, jwt, connectionMock } = buildService({ count: 1 });
        const state = signState({ bind: 123 }, jwt);

        await expect(
          service.verifyAndConsumeState(state, bindingToken),
        ).rejects.toThrow(UnauthorizedException);
        expect(connectionMock.updateMany).not.toHaveBeenCalled();
      });
    });

    it('rechaza un nonce ya consumido (replay)', async () => {
      const { service, jwt, connectionMock } = buildService({ count: 0 });
      const state = jwt.sign({
        sub: therapistId,
        purpose: OAUTH_STATE_PURPOSE,
        nonce,
        bind,
      });

      await expect(
        service.verifyAndConsumeState(state, bindingToken),
      ).rejects.toThrow(UnauthorizedException);
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
        bind,
      });

      const result = await service.verifyAndConsumeState(state, bindingToken);

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

  describe('buildAuthorizationUrl', () => {
    function buildService() {
      const { prisma } = buildPrismaMock();
      return new CalendarOauthService(
        prisma,
        buildJwt(),
        buildConfig(),
        buildTokenCrypto(),
        buildAuditServiceMock().auditService,
      );
    }

    // issue #497: el secreto de la cookie nunca viaja en el state ni en la URL;
    // el state solo lleva su hash.
    it('devuelve un bindingToken aleatorio cuyo hash va en el state y que no aparece en la URL', async () => {
      const service = buildService();

      const first = await service.buildAuthorizationUrl('therapist-1');
      const second = await service.buildAuthorizationUrl('therapist-1');

      expect(first.bindingToken).toMatch(/^[0-9a-f]{64}$/);
      expect(first.bindingToken).not.toBe(second.bindingToken);
      expect(first.url).not.toContain(first.bindingToken);

      const state = new URL(first.url).searchParams.get('state') as string;
      const payload = buildJwt().verify<{ bind: string }>(state);
      expect(payload.bind).toBe(
        createHash('sha256').update(first.bindingToken).digest('hex'),
      );
      expect(state).not.toContain(first.bindingToken);
    });

    it('el state emitido es aceptado con su cookie y rechazado sin ella', async () => {
      const { prisma } = buildPrismaMock();
      const service = new CalendarOauthService(
        prisma,
        buildJwt(),
        buildConfig(),
        buildTokenCrypto(),
        buildAuditServiceMock().auditService,
      );
      const { url, bindingToken } =
        await service.buildAuthorizationUrl('therapist-1');
      const state = new URL(url).searchParams.get('state') as string;

      await expect(
        service.verifyAndConsumeState(state, undefined),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.verifyAndConsumeState(state, bindingToken),
      ).resolves.toEqual({ therapistId: 'therapist-1' });
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

    // issue #497: consentimiento granular -- el usuario desmarca el permiso de
    // calendario pero Google igual entrega un refresh_token.
    describe('scope concedido', () => {
      function buildService() {
        const { prisma, connectionMock } = buildPrismaMock();
        connectionMock.update.mockResolvedValue({});
        const { auditService, logMock } = buildAuditServiceMock();
        const service = new CalendarOauthService(
          prisma,
          buildJwt(),
          buildConfig(),
          buildTokenCrypto(),
          auditService,
        );
        return { service, connectionMock, logMock };
      }

      it('rechaza, no persiste ni audita y NO revoca el token si falta el permiso de calendario', async () => {
        const { service, connectionMock, logMock } = buildService();
        const revokeToken = jest.fn().mockResolvedValue(undefined);
        stubOAuth2Client(service, {
          getToken: jest.fn().mockResolvedValue({
            tokens: {
              refresh_token: '1//sin-permiso-de-calendario',
              scope: 'openid email',
            },
          }),
          revokeToken,
        });

        await expect(
          service.exchangeCodeAndPersist('therapist-1', 'auth-code'),
        ).rejects.toThrow(UnauthorizedException);

        expect(connectionMock.update).not.toHaveBeenCalled();
        expect(logMock).not.toHaveBeenCalled();
        // Revocar el token nuevo puede invalidar el grant completo y romper la
        // conexión vigente de un terapeuta que solo reintentó el flujo.
        expect(revokeToken).not.toHaveBeenCalled();
      });

      it('rechaza una respuesta de Google sin scope', async () => {
        const { service, connectionMock } = buildService();
        stubOAuth2Client(service, {
          getToken: jest.fn().mockResolvedValue({
            tokens: { refresh_token: '1//token', scope: undefined },
          }),
        });

        await expect(
          service.exchangeCodeAndPersist('therapist-1', 'auth-code'),
        ).rejects.toThrow(UnauthorizedException);
        expect(connectionMock.update).not.toHaveBeenCalled();
      });

      it('no confunde un scope que solo contiene el nombre como prefijo', async () => {
        const { service, connectionMock } = buildService();
        stubOAuth2Client(service, {
          getToken: jest.fn().mockResolvedValue({
            tokens: {
              refresh_token: '1//token',
              scope: `${GOOGLE_CALENDAR_SCOPE}.readonly`,
            },
          }),
          revokeToken: jest.fn().mockResolvedValue(undefined),
        });

        await expect(
          service.exchangeCodeAndPersist('therapist-1', 'auth-code'),
        ).rejects.toThrow(UnauthorizedException);
        expect(connectionMock.update).not.toHaveBeenCalled();
      });

      it('conecta cuando el scope concedido incluye calendar.events junto a otros', async () => {
        const { service, connectionMock } = buildService();
        stubOAuth2Client(service, {
          getToken: jest.fn().mockResolvedValue({
            tokens: {
              refresh_token: '1//token',
              scope: `openid ${GOOGLE_CALENDAR_SCOPE}`,
            },
          }),
        });

        await service.exchangeCodeAndPersist('therapist-1', 'auth-code');

        expect(connectionMock.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'CONNECTED',
              scope: `openid ${GOOGLE_CALENDAR_SCOPE}`,
            }) as unknown,
          }),
        );
      });
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
      const { prisma, connectionMock, busyBlockMock } = buildPrismaMock();
      const tokenCrypto = buildTokenCrypto();
      const { auditService, logMock } = buildAuditServiceMock();
      const service = new CalendarOauthService(
        prisma,
        buildJwt(),
        buildConfig(),
        tokenCrypto,
        auditService,
      );
      return { service, connectionMock, busyBlockMock, tokenCrypto, logMock };
    }

    it('borra los CalendarBusyBlock del terapeuta al desconectar (issue #283)', async () => {
      const { service, connectionMock, busyBlockMock } = buildService();
      connectionMock.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        refreshTokenEncrypted: null,
      });
      connectionMock.update.mockResolvedValue({ status: 'DISCONNECTED' });

      await service.disconnect(therapistId);

      expect(busyBlockMock.deleteMany).toHaveBeenCalledWith({
        where: { therapistId },
      });
      // Reconectar enseguida no debe reutilizar un overlay "fresco" ya vacío.
      const callArg = connectionMock.update.mock.calls[0][0] as {
        data: { busySyncedAt: null };
      };
      expect(callArg.data.busySyncedAt).toBeNull();
    });

    it('si falla el borrado de CalendarBusyBlock, la desconexión igual termina y audita (issue #283)', async () => {
      const { service, connectionMock, busyBlockMock, logMock } =
        buildService();
      connectionMock.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        refreshTokenEncrypted: null,
      });
      connectionMock.update.mockResolvedValue({ status: 'DISCONNECTED' });
      busyBlockMock.deleteMany.mockRejectedValue(new Error('db caída'));

      await expect(service.disconnect(therapistId)).resolves.toEqual({
        status: 'DISCONNECTED',
      });
      expect(logMock).toHaveBeenCalled();
    });

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

    // issue #497: con una clave rotada o un dato corrupto el descifrado lanza;
    // el terapeuta igual debe poder desconectarse y el token cifrado borrarse.
    it('desconecta y borra el token aunque no se pueda descifrar', async () => {
      const { service, connectionMock, tokenCrypto, logMock } = buildService();
      connectionMock.findUnique.mockResolvedValue({
        status: 'CONNECTED',
        refreshTokenEncrypted: Buffer.from('basura-que-no-es-un-ciphertext'),
      });
      // Explícito: no depender de que el mock de cifrado falle por sí solo.
      jest.spyOn(tokenCrypto, 'decrypt').mockImplementation(() => {
        throw new Error('clave rotada o dato corrupto');
      });
      connectionMock.update.mockResolvedValue({ status: 'DISCONNECTED' });
      const revokeToken = jest.fn();
      stubOAuth2Client(service, { revokeToken });

      await expect(service.disconnect(therapistId)).resolves.toEqual({
        status: 'DISCONNECTED',
      });

      expect(revokeToken).not.toHaveBeenCalled();
      const callArg = connectionMock.update.mock.calls[0][0] as {
        data: { status: string; refreshTokenEncrypted: null };
      };
      expect(callArg.data.status).toBe('DISCONNECTED');
      expect(callArg.data.refreshTokenEncrypted).toBeNull();
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

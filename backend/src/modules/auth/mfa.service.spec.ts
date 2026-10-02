import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { Role, User } from '@prisma/client';
import { MfaService } from './mfa.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { MfaSecretCryptoService } from './mfa-secret-crypto.service';

jest.mock('argon2');
jest.mock('speakeasy');
jest.mock('qrcode');

const mockArgon2 = argon2 as jest.Mocked<typeof argon2>;
const mockSpeakeasy = speakeasy as jest.Mocked<typeof speakeasy>;
const mockQRCode = QRCode as jest.Mocked<typeof QRCode>;

// verifyDelta returns { delta } for a valid code and undefined otherwise.
function mockTotp(delta: number | null) {
  (mockSpeakeasy.totp.verifyDelta as jest.Mock).mockReturnValue(
    delta === null ? undefined : { delta },
  );
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    passwordHash: 'hashed-password',
    role: Role.PROFESSIONAL,
    mustChangePassword: false,
    mfaEnabled: false,
    mfaSecret: null,
    emailVerified: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as User;
}

describe('MfaService', () => {
  let service: MfaService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    mfaRecoveryCode: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
    };
    session: { create: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock; decode: jest.Mock };
  let auditService: { log: jest.Mock };
  let mailService: { sendMfaRecoveryNoticeEmail: jest.Mock };
  let crypto: MfaSecretCryptoService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mfaRecoveryCode: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
      },
      // $transaction soporta la forma array (ops ya construidas de antemano,
      // se resuelve con Promise.all) -- única forma que usa MfaService.
      session: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: jest.fn((arg: Promise<unknown>[]) => Promise.all(arg)),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
      decode: jest.fn().mockReturnValue({ exp: 2000000000 }),
    };
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mailService = {
      sendMfaRecoveryNoticeEmail: jest.fn().mockResolvedValue(undefined),
    };
    // Real crypto on purpose: the round trip is what these specs verify.
    crypto = new MfaSecretCryptoService({
      get: () => Buffer.alloc(32, 5).toString('base64'),
    } as unknown as ConfigService);
    crypto.onModuleInit();

    service = new MfaService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      auditService as unknown as AuditService,
      crypto,
      mailService as unknown as MailService,
    );

    // clearAllMocks() solo limpia historial de llamadas (calls/instances/
    // results), no implementations ni mockReturnValue — por eso no hace
    // falta re-declarar jwtService.sign.mockReturnValue después de esto.
    jest.clearAllMocks();
  });

  describe('beginMfaSetup / confirmMfaSetup', () => {
    const setupToken = 'setup-token';

    it('lanza 401 si el setupToken es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.beginMfaSetup(setupToken)).rejects.toThrow(
        'Token de configuración MFA inválido o expirado',
      );
    });

    it('lanza 401 si el purpose del token no es mfa-setup', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      await expect(service.beginMfaSetup(setupToken)).rejects.toThrow(
        'Token de configuración MFA inválido',
      );
    });

    it('lanza 401 (replay guard) si el usuario ya tiene MFA habilitado', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-setup',
      });
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));

      await expect(service.beginMfaSetup(setupToken)).rejects.toThrow(
        'MFA ya fue configurado para esta cuenta',
      );
    });

    it('beginMfaSetup genera el secreto MFA en el camino feliz', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-setup',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaEnabled: false }),
      );
      mockSpeakeasy.generateSecret.mockReturnValue({
        base32: 'BASE32SECRET',
        otpauth_url: 'otpauth://totp/test',
      } as never);
      (mockQRCode.toDataURL as jest.Mock).mockResolvedValue(
        'data:image/png;base64,xxx',
      );

      const result = await service.beginMfaSetup(setupToken);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          mfaSecret: expect.stringMatching(/^enc:v1:/) as unknown as string,
          lastUsedStep: null,
        },
      });
      expect(result).toEqual({
        secret: 'BASE32SECRET',
        qrCode: 'data:image/png;base64,xxx',
      });
    });

    it('confirmMfaSetup lanza 401 si el usuario desaparece entre enableMfa y la relectura final', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-setup',
      });
      const userWithSecret = buildUser({
        mfaEnabled: false,
        mfaSecret: 'BASE32SECRET',
      });
      prisma.user.findUnique
        .mockResolvedValueOnce(userWithSecret) // rejectIfAlreadyEnrolled
        .mockResolvedValueOnce(userWithSecret) // enableMfa
        .mockResolvedValueOnce(null); // relectura final en confirmMfaSetup
      mockTotp(0);

      await expect(
        service.confirmMfaSetup(setupToken, '123456'),
      ).rejects.toThrow('Usuario no válido');
    });

    it('confirmMfaSetup valida el token, habilita MFA y devuelve accessToken', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-setup',
      });
      const userWithSecret = buildUser({
        mfaEnabled: false,
        mfaSecret: 'BASE32SECRET',
      });
      prisma.user.findUnique.mockResolvedValue(userWithSecret);
      mockTotp(0);

      const result = await service.confirmMfaSetup(setupToken, '123456');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: true },
      });
      expect(result).toEqual({
        accessToken: 'signed-token',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          role: Role.PROFESSIONAL,
          name: 'Test User',
        },
        recoveryCodes: expect.arrayContaining([
          expect.any(String) as unknown as string,
        ]) as unknown as string[],
      });
      expect(result.recoveryCodes).toHaveLength(10);
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyMfa', () => {
    const dto = { mfaToken: 'mfa-token', token: '123456' };

    beforeEach(() => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-verify',
      });
    });

    it('lanza 401 si el mfaToken es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('lanza 401 si el purpose del token no es mfa-verify (ej. mfa-setup)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-setup',
      });

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('lanza 401 si el token no tiene purpose (JWT de sesión)', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1' });

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
    });

    it('lanza 401 con el mismo mensaje que un TOTP inválido si el usuario no existe (anti-enumeración)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
    });

    it('lanza 401 si el usuario no tiene mfaSecret', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaEnabled: true, mfaSecret: null }),
      );

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
    });

    it('lanza 401 si el usuario tiene mfaSecret pero mfaEnabled=false (enrolamiento pendiente), aunque el TOTP sea válido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: false }),
      );
      mockTotp(0);

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('lanza 401 si la cuenta está soft-deleted, aunque el TOTP sea válido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          mfaSecret: 'BASE32SECRET',
          mfaEnabled: true,
          deletedAt: new Date(),
        }),
      );
      mockTotp(0);

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
      // No debe llegar a emitir accessToken para una cuenta desactivada.
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('lanza 401 si el TOTP es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(null);

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('lanza 401 si el mismo paso TOTP ya fue consumido (replay)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('consume el paso de forma atómica: solo avanza lastUsedStep si es mayor', async () => {
      const now = 1_700_000_000_000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(-1);

      await service.verifyMfa(dto);
      nowSpy.mockRestore();

      const step = Math.floor(now / 1000 / 30) - 1;
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'user-1',
          OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
        },
        data: { lastUsedStep: step },
      });
    });

    it('lanza 401 sin emitir accessToken si mustChangePassword=true, aunque el TOTP sea válido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          mfaSecret: 'BASE32SECRET',
          mfaEnabled: true,
          mustChangePassword: true,
        }),
      );
      mockTotp(0);

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Debes cambiar tu contraseña antes de iniciar sesión',
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('no revela mustChangePassword si el TOTP es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          mfaSecret: 'BASE32SECRET',
          mfaEnabled: true,
          mustChangePassword: true,
        }),
      );
      mockTotp(null);

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
    });

    it('crea una Session con el jti firmado en el JWT, expiresAt del exp e ip/user-agent', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);

      await service.verifyMfa(dto, '10.0.0.1', 'jest-agent');

      const [payload] = jwtService.sign.mock.calls[0] as [
        { jti: string; sub: string },
      ];
      expect(payload.sub).toBe('user-1');
      expect(payload.jti).toEqual(expect.any(String));
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: {
          jti: payload.jti,
          userId: 'user-1',
          expiresAt: new Date(2000000000 * 1000),
          ipAddress: '10.0.0.1',
          userAgent: 'jest-agent',
        },
      });
    });

    it('devuelve accessToken si el mfaToken y el TOTP son válidos', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);

      const result = await service.verifyMfa(dto);

      expect(jwtService.verify).toHaveBeenCalledWith('mfa-token');
      expect(mockSpeakeasy.totp.verifyDelta).toHaveBeenCalledWith({
        secret: 'BASE32SECRET',
        encoding: 'base32',
        token: '123456',
        window: 1,
      });
      expect(result).toEqual({
        accessToken: 'signed-token',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          role: Role.PROFESSIONAL,
          name: 'Test User',
        },
      });
    });
  });

  describe('mfaSecret cifrado en reposo (issue #302)', () => {
    const dto = { mfaToken: 'mfa-token', token: '123456' };

    beforeEach(() => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-verify',
      });
    });

    it('verifyMfa descifra el secreto guardado antes de validar el TOTP y no re-escribe uno ya cifrado', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          mfaSecret: crypto.encrypt('BASE32SECRET'),
          mfaEnabled: true,
        }),
      );
      mockTotp(0);

      await service.verifyMfa(dto);

      expect(mockSpeakeasy.totp.verifyDelta).toHaveBeenCalledWith(
        expect.objectContaining({ secret: 'BASE32SECRET' }),
      );
      // Only consumeTotp's lastUsedStep update; no re-encryption write.
      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('verifyMfa acepta un secreto legado en texto plano y lo re-cifra de forma condicional', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);

      await service.verifyMfa(dto);

      expect(mockSpeakeasy.totp.verifyDelta).toHaveBeenCalledWith(
        expect.objectContaining({ secret: 'BASE32SECRET' }),
      );
      const calls = prisma.user.updateMany.mock.calls as Array<
        [{ where: unknown; data: { mfaSecret: string } }]
      >;
      const reencrypt = calls[1][0];
      expect(reencrypt.where).toEqual({
        id: 'user-1',
        mfaSecret: 'BASE32SECRET',
      });
      expect(reencrypt.data.mfaSecret).toMatch(/^enc:v1:/);
      expect(crypto.decrypt(reencrypt.data.mfaSecret)).toBe('BASE32SECRET');
    });

    it('verifyMfa no falla si el re-cifrado del secreto legado falla', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);
      prisma.user.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(new Error('db down'));

      await expect(service.verifyMfa(dto)).resolves.toHaveProperty(
        'accessToken',
      );
    });

    it('verifyMfa rechaza con 401 un secreto cifrado alterado, sin validar el TOTP', async () => {
      const tampered = crypto.encrypt('BASE32SECRET').slice(0, -4) + 'AAAA';
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: tampered, mfaEnabled: true }),
      );

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
      expect(mockSpeakeasy.totp.verifyDelta).not.toHaveBeenCalled();
    });

    it('verifyMfa rechaza con 401 un valor con el prefijo pero basura', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'enc:v1:not-a-payload', mfaEnabled: true }),
      );

      await expect(service.verifyMfa(dto)).rejects.toThrow(
        'Código MFA inválido',
      );
    });

    it('enableMfa y disableMfa también descifran el secreto antes de validar', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: crypto.encrypt('BASE32SECRET') }),
      );
      mockTotp(0);

      await service.enableMfa('user-1', '123456');
      await service.disableMfa('user-1', '123456');

      expect(mockSpeakeasy.totp.verifyDelta).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ secret: 'BASE32SECRET' }),
      );
      expect(mockSpeakeasy.totp.verifyDelta).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ secret: 'BASE32SECRET' }),
      );
    });

    it('enableMfa y disableMfa rechazan con 400 un secreto ilegible', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'enc:v1:garbage' }),
      );

      await expect(service.enableMfa('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.disableMfa('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSpeakeasy.totp.verifyDelta).not.toHaveBeenCalled();
    });
  });

  describe('generateMfaSecret', () => {
    it('lanza 401 si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.generateMfaSecret('user-1')).rejects.toThrow(
        'Usuario no válido',
      );
    });

    it('lanza 401 si MFA ya está activo (exige desactivarlo primero, no alcanza con un accessToken)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaEnabled: true, mfaSecret: 'BASE32SECRET' }),
      );

      await expect(service.generateMfaSecret('user-1')).rejects.toThrow(
        'MFA ya está activo. Desactívalo primero para regenerar el secreto.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('genera y persiste el secreto, devolviendo el QR', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      mockSpeakeasy.generateSecret.mockReturnValue({
        base32: 'BASE32SECRET',
        otpauth_url: 'otpauth://totp/test',
      } as never);
      (mockQRCode.toDataURL as jest.Mock).mockResolvedValue(
        'data:image/png;base64,xxx',
      );

      const result = await service.generateMfaSecret('user-1');

      expect(mockSpeakeasy.generateSecret).toHaveBeenCalledWith({
        name: 'Umbral - RCE (user@example.com)',
        length: 20,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          mfaSecret: expect.stringMatching(/^enc:v1:/) as unknown as string,
          lastUsedStep: null,
        },
      });
      expect(result).toEqual({
        secret: 'BASE32SECRET',
        qrCode: 'data:image/png;base64,xxx',
      });
    });
  });

  describe('enableMfa', () => {
    it('lanza 400 si no hay usuario o no tiene secreto generado', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.enableMfa('user-1', '123456')).rejects.toThrow(
        'Primero genera el secreto MFA',
      );
    });

    it('lanza 400 si el TOTP es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      mockTotp(null);

      await expect(service.enableMfa('user-1', '000000')).rejects.toThrow(
        'Código inválido, intenta de nuevo',
      );
    });

    it('lanza 400 si el TOTP ya fue usado en este paso (replay)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      mockTotp(0);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.enableMfa('user-1', '123456')).rejects.toThrow(
        'Código inválido, intenta de nuevo',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('activa MFA, genera 10 recovery codes y audita en el camino feliz', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      mockTotp(0);
      mockArgon2.hash.mockResolvedValue('hashed-code' as never);

      const result = await service.enableMfa('user-1', '123456');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: true },
      });
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.mfaRecoveryCode.createMany).toHaveBeenCalledWith({
        data: Array(10).fill({ userId: 'user-1', codeHash: 'hashed-code' }),
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'MFA_RECOVERY_CODES_GENERATED',
        resource: 'User',
        resourceId: 'user-1',
      });
      expect(result.message).toBe('MFA activado correctamente');
      expect(result.recoveryCodes).toHaveLength(10);
      expect(new Set(result.recoveryCodes).size).toBe(10);
    });
  });

  describe('disableMfa', () => {
    it('lanza 400 si no hay usuario o no tiene secreto', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.disableMfa('user-1', '123456')).rejects.toThrow(
        'MFA no está configurado',
      );
    });

    it('lanza 400 si el TOTP es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      mockTotp(null);

      await expect(service.disableMfa('user-1', '000000')).rejects.toThrow(
        'Código inválido',
      );
    });

    it('desactiva MFA y limpia el secreto en el camino feliz', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);

      const result = await service.disableMfa('user-1', '123456');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: false, mfaSecret: null, lastUsedStep: null },
      });
      expect(result).toEqual({ message: 'MFA desactivado correctamente' });
    });

    it('lanza 400 si el TOTP ya fue usado en este paso (replay)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.disableMfa('user-1', '123456')).rejects.toThrow(
        'Código inválido',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('auditoría de autenticación (issue #283)', () => {
    const verifyDto = { mfaToken: 'mfa-token', token: '123456' };
    const recoverDto = {
      email: 'user@example.com',
      password: 'password1',
      recoveryCode: 'a1b2-c3d4',
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('registra LOGIN con ip y user-agent al emitir la sesión tras verificar el TOTP', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-verify',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);

      await service.verifyMfa(verifyDto, '203.0.113.7', 'jest-agent');

      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'LOGIN',
        resource: 'Auth',
        resourceId: 'user-1',
        ipAddress: '203.0.113.7',
        userAgent: 'jest-agent',
      });
    });

    it('un fallo al registrar LOGIN no rompe la emisión de la sesión (fail-open)', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      auditService.log.mockRejectedValue(new Error('DB caída'));
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-verify',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(0);

      const result = await service.verifyMfa(verifyDto);

      expect(result.accessToken).toBe('signed-token');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it('registra LOGIN una sola vez en el enrolamiento forzado', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-setup',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaEnabled: false, mfaSecret: 'BASE32SECRET' }),
      );
      mockTotp(0);

      await service.confirmMfaSetup('setup-token', '123456', '10.0.0.1', 'ua');

      const logins = auditService.log.mock.calls.filter(
        ([entry]: [{ action: string }]) => entry.action === 'LOGIN',
      );
      expect(logins).toHaveLength(1);
    });

    it('registra MFA_FAILED con ip y user-agent si el TOTP es inválido, sin el código', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-verify',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(null);

      await expect(
        service.verifyMfa(verifyDto, '203.0.113.7', 'jest-agent'),
      ).rejects.toThrow('Código MFA inválido');
      await flush();

      expect(auditService.log).toHaveBeenCalledTimes(1);
      const entry = (
        auditService.log.mock.calls as Array<[Record<string, string>]>
      )[0][0];
      expect(entry).toMatchObject({
        userId: 'user-1',
        action: 'MFA_FAILED',
        ipAddress: '203.0.113.7',
        userAgent: 'jest-agent',
      });
      expect(JSON.stringify(entry)).not.toContain('123456');
    });

    it('no registra nada si el mfaToken es inválido (no hay userId confiable)', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.verifyMfa(verifyDto)).rejects.toThrow(
        'Código MFA inválido',
      );
      await flush();

      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('un fallo al registrar MFA_FAILED no cambia la excepción lanzada', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      auditService.log.mockRejectedValue(new Error('DB caída'));
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'mfa-verify',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      mockTotp(null);

      await expect(service.verifyMfa(verifyDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await flush();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it('registra MFA_FAILED si el código de recuperación es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);
      prisma.mfaRecoveryCode.findMany.mockResolvedValue([
        { id: 'code-1', codeHash: 'hash-1' },
      ]);

      await expect(
        service.recoverMfa(recoverDto, '203.0.113.7', 'jest-agent'),
      ).rejects.toThrow('Código de recuperación inválido');
      await flush();

      expect(auditService.log).toHaveBeenCalledTimes(1);
      const entry = (
        auditService.log.mock.calls as Array<[Record<string, string>]>
      )[0][0];
      expect(entry).toMatchObject({
        userId: 'user-1',
        action: 'MFA_FAILED',
        ipAddress: '203.0.113.7',
        userAgent: 'jest-agent',
      });
      expect(JSON.stringify(entry)).not.toContain('a1b2-c3d4');
    });

    it('registra LOGIN_FAILED si la contraseña de recoverMfa es incorrecta, sin filas para emails desconocidos', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify.mockResolvedValue(false as never);

      await expect(service.recoverMfa(recoverDto, '1.1.1.1')).rejects.toThrow(
        'Credenciales inválidas',
      );
      await flush();
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', action: 'LOGIN_FAILED' }),
      );

      auditService.log.mockClear();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.recoverMfa(recoverDto)).rejects.toThrow(
        'Credenciales inválidas',
      );
      await flush();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('recoverMfa', () => {
    const dto = {
      email: 'user@example.com',
      password: 'password1',
      recoveryCode: 'a1b2-c3d4',
    };

    it('lanza 401 genérico si el usuario no existe o está soft-deleted', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.recoverMfa(dto)).rejects.toThrow(
        'Credenciales inválidas',
      );
    });

    // Issue #303: el lookup usa el email canónico aunque el servicio se llame
    // sin pasar por el ValidationPipe.
    it('busca al usuario por el email recortado y en minúsculas', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.recoverMfa({ ...dto, email: '  User@Example.COM ' }),
      ).rejects.toThrow('Credenciales inválidas');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });

    it('corre un argon2.verify dummy si el usuario no existe (cierra el timing oracle)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.recoverMfa(dto)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockArgon2.verify).toHaveBeenCalledTimes(1);
      expect(mockArgon2.verify).toHaveBeenCalledWith(
        expect.anything(),
        'password1',
      );
    });

    it('lanza 401 genérico si la contraseña es incorrecta', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify.mockResolvedValue(false as never);

      await expect(service.recoverMfa(dto)).rejects.toThrow(
        'Credenciales inválidas',
      );
    });

    it('lanza 401 si la cuenta no tiene MFA habilitado', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaEnabled: false }),
      );
      mockArgon2.verify.mockResolvedValue(true as never);

      await expect(service.recoverMfa(dto)).rejects.toThrow(
        'MFA no está configurado',
      );
    });

    it('lanza 401 si ningún código sin usar matchea', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify
        .mockResolvedValueOnce(true as never) // password
        .mockResolvedValueOnce(false as never) // recovery code candidate #1
        .mockResolvedValueOnce(false as never); // recovery code candidate #2
      prisma.mfaRecoveryCode.findMany.mockResolvedValue([
        { id: 'code-1', codeHash: 'hash-1' },
        { id: 'code-2', codeHash: 'hash-2' },
      ]);

      await expect(service.recoverMfa(dto)).rejects.toThrow(
        'Código de recuperación inválido',
      );
      expect(prisma.mfaRecoveryCode.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
      });
    });

    it('camino feliz: consume el código, desactiva MFA y audita', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify
        .mockResolvedValueOnce(true as never) // password
        .mockResolvedValueOnce(false as never) // recovery code candidate #1 (no matchea)
        .mockResolvedValueOnce(true as never); // recovery code candidate #2 (matchea)
      prisma.mfaRecoveryCode.findMany.mockResolvedValue([
        { id: 'code-1', codeHash: 'hash-1' },
        { id: 'code-2', codeHash: 'hash-2' },
      ]);

      const result = await service.recoverMfa(dto, '203.0.113.7', 'jest-agent');

      expect(prisma.mfaRecoveryCode.update).toHaveBeenCalledWith({
        where: { id: 'code-2' },
        data: { usedAt: expect.any(Date) as unknown as Date },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: false, mfaSecret: null, lastUsedStep: null },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'MFA_DISABLED_VIA_RECOVERY',
        resource: 'User',
        resourceId: 'user-1',
        ipAddress: '203.0.113.7',
        userAgent: 'jest-agent',
      });
      // Issue #302: every active session is revoked in the same transaction.
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as Date },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mailService.sendMfaRecoveryNoticeEmail).toHaveBeenCalledWith(
        'user@example.com',
        'Test User',
        '203.0.113.7',
        'jest-agent',
      );
      expect(result).toEqual({
        message:
          'MFA desactivado con el código de recuperación. Vuelve a habilitarlo cuanto antes.',
      });
    });

    it('no rompe la recuperación si el correo de aviso falla', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(true as never);
      prisma.mfaRecoveryCode.findMany.mockResolvedValue([
        { id: 'code-1', codeHash: 'hash-1' },
      ]);
      mailService.sendMfaRecoveryNoticeEmail.mockRejectedValue(
        new Error('resend down'),
      );

      await expect(service.recoverMfa(dto)).resolves.toHaveProperty('message');
    });

    it('no revoca sesiones ni envía aviso si el código de recuperación es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify
        .mockResolvedValueOnce(true as never)
        .mockResolvedValueOnce(false as never);
      prisma.mfaRecoveryCode.findMany.mockResolvedValue([
        { id: 'code-1', codeHash: 'hash-1' },
      ]);

      await expect(service.recoverMfa(dto)).rejects.toThrow(
        'Código de recuperación inválido',
      );
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
      expect(mailService.sendMfaRecoveryNoticeEmail).not.toHaveBeenCalled();
    });
  });
});

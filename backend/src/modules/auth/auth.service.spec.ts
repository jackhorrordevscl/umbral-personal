import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { Role, User } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';

jest.mock('argon2');
jest.mock('speakeasy');
jest.mock('qrcode');

const mockArgon2 = argon2 as jest.Mocked<typeof argon2>;
const mockSpeakeasy = speakeasy as jest.Mocked<typeof speakeasy>;
const mockQRCode = QRCode as jest.Mocked<typeof QRCode>;

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

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    mfaRecoveryCode: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let config: { get: jest.Mock };
  let mailService: { sendVerificationEmail: jest.Mock; sendPasswordResetEmail: jest.Mock };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      mfaRecoveryCode: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
      },
      // $transaction([...]) real ejecuta cada operación y devuelve sus
      // resultados; acá alcanza con resolver el array de promesas ya creadas
      // (los mocks individuales de arriba ya devuelven promesas resueltas).
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    };
    config = {
      get: jest.fn(),
    };
    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      config as unknown as ConfigService,
      mailService as unknown as MailService,
      auditService as unknown as AuditService,
    );

    // clearAllMocks() solo limpia historial de llamadas (calls/instances/
    // results), no implementations ni mockReturnValue — por eso no hace
    // falta re-declarar jwtService.sign.mockReturnValue después de esto.
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('lanza 409 si el email ya está registrado', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(
        service.signup({
          email: 'user@example.com',
          password: 'password1',
          name: 'Nueva Cuenta',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('crea la cuenta con emailVerified=false y envía el email de verificación', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      mockArgon2.hash.mockResolvedValue('hashed-password' as never);
      prisma.user.create.mockResolvedValue(
        buildUser({ emailVerified: false }),
      );
      config.get.mockImplementation((key: string) =>
        key === 'FRONTEND_URL' ? 'http://localhost:5173' : undefined,
      );

      const result = await service.signup({
        email: 'user@example.com',
        password: 'password1',
        name: 'Test User',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'user@example.com',
          passwordHash: 'hashed-password',
          name: 'Test User',
          emailVerified: false,
        },
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', purpose: 'email-verify' },
        { expiresIn: '24h' },
      );
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        'Test User',
        'http://localhost:5173/verify-email?token=signed-token',
      );
      expect(result).toEqual({
        message: 'Cuenta creada. Revisa tu email para verificarla antes de iniciar sesión.',
      });
    });
  });

  describe('verifyEmail', () => {
    it('lanza 401 si el token es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.verifyEmail('bad-token')).rejects.toThrow(
        'Token de verificación inválido o expirado',
      );
    });

    it('lanza 401 si el purpose del token no es email-verify', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      await expect(service.verifyEmail('token')).rejects.toThrow(
        'Token de verificación inválido',
      );
    });

    it('lanza 401 (replay guard) si el email ya estaba verificado', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-verify',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ emailVerified: true }),
      );

      await expect(service.verifyEmail('token')).rejects.toThrow(
        'Este email ya fue verificado',
      );
    });

    it('marca emailVerified=true en el camino feliz', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-verify',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ emailVerified: false }),
      );

      const result = await service.verifyEmail('token');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { emailVerified: true },
      });
      expect(result).toEqual({
        message: 'Email verificado. Ya puedes iniciar sesión.',
      });
    });
  });

  describe('login', () => {
    it('lanza 401 si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'no@example.com', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ email: 'no@example.com', password: 'password1' }),
      ).rejects.toThrow('Credenciales inválidas');
    });

    it('lanza 401 si el usuario está soft-deleted (deletedAt seteado)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ deletedAt: new Date() }),
      );

      await expect(
        service.login({ email: 'user@example.com', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lanza 401 si la contraseña es incorrecta', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      mockArgon2.verify.mockResolvedValue(false as never);

      await expect(
        service.login({ email: 'user@example.com', password: 'wrong-pass' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockArgon2.verify).toHaveBeenCalledWith(
        'hashed-password',
        'wrong-pass',
      );
    });

    it('lanza 401 si el email no está verificado (signup propio, issue #5)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ emailVerified: false }),
      );
      mockArgon2.verify.mockResolvedValue(true as never);

      await expect(
        service.login({ email: 'user@example.com', password: 'password1' }),
      ).rejects.toThrow('Debes verificar tu email antes de iniciar sesión');
    });

    it('devuelve requiresPasswordChange sin loguear si mustChangePassword=true', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mustChangePassword: true }),
      );
      mockArgon2.verify.mockResolvedValue(true as never);

      const result = await service.login({
        email: 'user@example.com',
        password: 'password1',
      });

      expect(result).toEqual({
        requiresPasswordChange: true,
        passwordChangeToken: 'signed-token',
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', purpose: 'password-change' },
        { expiresIn: '10m' },
      );
    });

    it('devuelve requiresMfaSetup si el usuario no tiene MFA habilitado (obligatorio para toda cuenta)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      mockArgon2.verify.mockResolvedValue(true as never);

      const result = await service.login({
        email: 'user@example.com',
        password: 'password1',
      });

      expect(result).toEqual({
        requiresMfaSetup: true,
        setupToken: 'signed-token',
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', purpose: 'mfa-setup' },
        { expiresIn: '10m' },
      );
    });

    it('devuelve requiresMfa si el usuario ya tiene MFA habilitado', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaEnabled: true }),
      );
      mockArgon2.verify.mockResolvedValue(true as never);

      const result = await service.login({
        email: 'user@example.com',
        password: 'password1',
      });

      expect(result).toEqual({ requiresMfa: true, userId: 'user-1' });
    });
  });

  describe('changePassword', () => {
    const passwordChangeToken = 'password-change-token';

    it('lanza 401 si el token es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.changePassword({
          passwordChangeToken,
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.changePassword({
          passwordChangeToken,
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Token de cambio de contraseña inválido o expirado');
    });

    it('lanza 401 si el purpose del token no es password-change', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      await expect(
        service.changePassword({
          passwordChangeToken,
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Token de cambio de contraseña inválido');
    });

    it('lanza 401 si el usuario no existe o está soft-deleted', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-change',
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword({
          passwordChangeToken,
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Usuario no válido');
    });

    it('lanza 401 si mustChangePassword ya es false (replay guard)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-change',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mustChangePassword: false }),
      );

      await expect(
        service.changePassword({
          passwordChangeToken,
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('La contraseña ya fue actualizada anteriormente');
    });

    it('cambia la contraseña, limpia el flag y delega en completeLogin (MFA obligatorio: requiresMfaSetup)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-change',
      });
      const user = buildUser({ mustChangePassword: true });
      prisma.user.findUnique.mockResolvedValue(user);
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);
      prisma.user.update.mockResolvedValue(
        buildUser({ mustChangePassword: false }),
      );

      const result = await service.changePassword({
        passwordChangeToken,
        newPassword: 'newpassword1',
      });

      expect(mockArgon2.hash).toHaveBeenCalledWith('newpassword1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new-hashed-password',
          mustChangePassword: false,
        },
      });
      expect(result).toEqual({
        requiresMfaSetup: true,
        setupToken: 'signed-token',
      });
    });
  });

  describe('forgotPassword', () => {
    it('responde el mensaje genérico sin tocar prisma si el email no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'no@example.com' });

      expect(result).toEqual({
        message:
          'Si el email está registrado, vas a recibir un enlace para restablecer tu contraseña.',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('responde el mismo mensaje genérico si el usuario está soft-deleted (no filtra existencia)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));

      const result = await service.forgotPassword({ email: 'user@example.com' });

      expect(result).toEqual({
        message:
          'Si el email está registrado, vas a recibir un enlace para restablecer tu contraseña.',
      });
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('persiste el timestamp, firma el token y envía el email en el camino feliz', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      config.get.mockImplementation((key: string) =>
        key === 'FRONTEND_URL' ? 'http://localhost:5173' : undefined,
      );

      const result = await service.forgotPassword({ email: 'user@example.com' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordResetTokenIssuedAt: expect.any(Date) },
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', purpose: 'password-reset' }),
        { expiresIn: '30m' },
      );
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        'Test User',
        'http://localhost:5173/reset-password?token=signed-token',
      );
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'PASSWORD_RESET_REQUESTED',
        resource: 'User',
        resourceId: 'user-1',
      });
      expect(result).toEqual({
        message:
          'Si el email está registrado, vas a recibir un enlace para restablecer tu contraseña.',
      });
    });
  });

  describe('resetPassword', () => {
    it('lanza 401 si el token es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.resetPassword({ resetToken: 'bad-token', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Token de restablecimiento inválido o expirado');
    });

    it('lanza 401 si el purpose del token no es password-reset', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      await expect(
        service.resetPassword({ resetToken: 'token', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Token de restablecimiento inválido');
    });

    it('lanza 401 si el usuario no existe o está soft-deleted', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({ resetToken: 'token', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Usuario no válido');
    });

    it('lanza 401 (replay guard) si el timestamp no coincide con el guardado', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: new Date(2000) } as any),
      );

      await expect(
        service.resetPassword({ resetToken: 'token', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Token de restablecimiento inválido o ya utilizado');
    });

    it('lanza 401 (replay guard) si ya no hay ningún reset pendiente (token ya usado)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: null } as any),
      );

      await expect(
        service.resetPassword({ resetToken: 'token', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Token de restablecimiento inválido o ya utilizado');
    });

    it('resetea la contraseña, limpia el timestamp y no emite accessToken en el camino feliz', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: new Date(1000) } as any),
      );
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);

      const result = await service.resetPassword({
        resetToken: 'token',
        newPassword: 'newpassword1',
      });

      expect(mockArgon2.hash).toHaveBeenCalledWith('newpassword1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-hashed-password', passwordResetTokenIssuedAt: null },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'PASSWORD_RESET_COMPLETED',
        resource: 'User',
        resourceId: 'user-1',
      });
      expect(result).toEqual({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
    });
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
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaEnabled: true }),
      );

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
        data: { mfaSecret: 'BASE32SECRET' },
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
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(true);

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
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(true);

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
        recoveryCodes: expect.arrayContaining([expect.any(String)]),
      });
      expect(result.recoveryCodes).toHaveLength(10);
    });
  });

  describe('verifyMfa', () => {
    it('lanza 401 si el usuario no existe o no tiene mfaSecret', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyMfa({ userId: 'user-1', token: '123456' }),
      ).rejects.toThrow('Usuario no válido');
    });

    it('lanza 401 si el TOTP es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(false);

      await expect(
        service.verifyMfa({ userId: 'user-1', token: '000000' }),
      ).rejects.toThrow('Código MFA inválido');
    });

    it('devuelve accessToken si el TOTP es válido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(true);

      const result = await service.verifyMfa({
        userId: 'user-1',
        token: '123456',
      });

      expect(mockSpeakeasy.totp.verify).toHaveBeenCalledWith({
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

  describe('generateMfaSecret', () => {
    it('lanza 401 si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.generateMfaSecret('user-1')).rejects.toThrow(
        'Usuario no válido',
      );
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
        name: 'Umbral SpA (user@example.com)',
        length: 20,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaSecret: 'BASE32SECRET' },
      });
      expect(result).toEqual({
        secret: 'BASE32SECRET',
        qrCode: 'data:image/png;base64,xxx',
      });
    });
  });

  describe('enableMfa', () => {
    it('lanza 401 si no hay usuario o no tiene secreto generado', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.enableMfa('user-1', '123456')).rejects.toThrow(
        'Primero genera el secreto MFA',
      );
    });

    it('lanza 401 si el TOTP es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(false);

      await expect(service.enableMfa('user-1', '000000')).rejects.toThrow(
        'Código inválido, intenta de nuevo',
      );
    });

    it('activa MFA, genera 10 recovery codes y audita en el camino feliz', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(true);
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
    it('lanza 401 si no hay usuario o no tiene secreto', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.disableMfa('user-1', '123456')).rejects.toThrow(
        'MFA no está configurado',
      );
    });

    it('lanza 401 si el TOTP es inválido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(false);

      await expect(service.disableMfa('user-1', '000000')).rejects.toThrow(
        'Código inválido',
      );
    });

    it('desactiva MFA y limpia el secreto en el camino feliz', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET', mfaEnabled: true }),
      );
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(true);

      const result = await service.disableMfa('user-1', '123456');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: false, mfaSecret: null },
      });
      expect(result).toEqual({ message: 'MFA desactivado correctamente' });
    });
  });

  describe('recoverMfa', () => {
    const dto = { email: 'user@example.com', password: 'password1', recoveryCode: 'a1b2-c3d4' };

    it('lanza 401 genérico si el usuario no existe o está soft-deleted', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.recoverMfa(dto)).rejects.toThrow('Credenciales inválidas');
    });

    it('lanza 401 genérico si la contraseña es incorrecta', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify.mockResolvedValue(false as never);

      await expect(service.recoverMfa(dto)).rejects.toThrow('Credenciales inválidas');
    });

    it('lanza 401 si la cuenta no tiene MFA habilitado', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: false }));
      mockArgon2.verify.mockResolvedValue(true as never);

      await expect(service.recoverMfa(dto)).rejects.toThrow('MFA no está configurado');
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

      await expect(service.recoverMfa(dto)).rejects.toThrow('Código de recuperación inválido');
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

      const result = await service.recoverMfa(dto);

      expect(prisma.mfaRecoveryCode.update).toHaveBeenCalledWith({
        where: { id: 'code-2' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: false, mfaSecret: null },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'MFA_DISABLED_VIA_RECOVERY',
        resource: 'User',
        resourceId: 'user-1',
      });
      expect(result).toEqual({
        message: 'MFA desactivado con el código de recuperación. Vuelve a habilitarlo cuanto antes.',
      });
    });
  });
});

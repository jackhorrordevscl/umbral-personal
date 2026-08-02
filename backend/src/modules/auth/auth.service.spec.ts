import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { Role, User } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    role: Role.THERAPIST,
    mustChangePassword: false,
    mfaEnabled: false,
    mfaSecret: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as User;
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
    );

    // clearAllMocks() solo limpia historial de llamadas (calls/instances/
    // results), no implementations ni mockReturnValue — por eso no hace
    // falta re-declarar jwtService.sign.mockReturnValue después de esto.
    jest.clearAllMocks();
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

    it('delega en completeLogin (camino normal) devolviendo accessToken', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      mockArgon2.verify.mockResolvedValue(true as never);

      const result = await service.login({
        email: 'user@example.com',
        password: 'password1',
      });

      expect(result).toEqual({
        accessToken: 'signed-token',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          role: Role.THERAPIST,
          name: 'Test User',
        },
      });
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

    it('devuelve requiresMfaSetup si el rol es administrativo (ADMIN/SUPERVISOR) sin MFA', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ role: Role.ADMIN, mfaEnabled: false }),
      );
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

    it('cambia la contraseña, limpia el flag y delega en completeLogin', async () => {
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
        accessToken: 'signed-token',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          role: Role.THERAPIST,
          name: 'Test User',
        },
      });
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
          role: Role.THERAPIST,
          name: 'Test User',
        },
      });
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
          role: Role.THERAPIST,
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

    it('activa MFA en el camino feliz', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mfaSecret: 'BASE32SECRET' }),
      );
      (mockSpeakeasy.totp.verify as jest.Mock).mockReturnValue(true);

      const result = await service.enableMfa('user-1', '123456');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { mfaEnabled: true },
      });
      expect(result).toEqual({ message: 'MFA activado correctamente' });
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
});

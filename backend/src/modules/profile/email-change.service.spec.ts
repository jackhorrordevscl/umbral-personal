import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { EmailChangeService } from './email-change.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'old@example.com',
    name: 'Test User',
    passwordHash: 'hashed-password',
    emailVerified: true,
    pendingEmail: null,
    pendingEmailTokenIssuedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as User;
}

/**
 * Issue #76: cambio de email self-service diferido -- pendingEmail nunca
 * pisa `email` directo, solo se activa cuando el dueño confirma desde la
 * nueva casilla. Mismo patrón de replay guard que
 * AuthService.forgotPassword/resetPassword (passwordResetTokenIssuedAt),
 * pero con un purpose de JWT propio ('email-change') que además liga la
 * dirección pendiente (`pendingEmail` en el payload): un token filtrado no
 * sirve para confirmar una dirección distinta a la que se pidió.
 */
describe('EmailChangeService', () => {
  let service: EmailChangeService;
  let prisma: { user: { update: jest.Mock; findUnique: jest.Mock } };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let config: { get: jest.Mock };
  let mailService: {
    sendEmailChangeVerificationEmail: jest.Mock;
    sendEmailChangeNoticeEmail: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        update: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    };
    config = {
      get: jest.fn(),
    };
    mailService = {
      sendEmailChangeVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeNoticeEmail: jest.fn().mockResolvedValue(undefined),
    };
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    service = new EmailChangeService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      config as unknown as ConfigService,
      mailService as unknown as MailService,
      auditService as unknown as AuditService,
    );

    jest.clearAllMocks();
  });

  describe('requestChange', () => {
    it('persiste pendingEmail + pendingEmailTokenIssuedAt, firma el token con purpose email-change y envía ambos emails', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'FRONTEND_URL' ? 'http://localhost:5173' : undefined,
      );

      await service.requestChange(
        { id: 'user-1', email: 'old@example.com', name: 'Test User' },
        'new@example.com',
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          pendingEmail: 'new@example.com',
          pendingEmailTokenIssuedAt: expect.any(Date) as unknown as Date,
        },
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          purpose: 'email-change',
          pendingEmail: 'new@example.com',
          changeIssuedAt: expect.any(Number) as unknown as number,
        }),
        { expiresIn: '24h' },
      );
      expect(mailService.sendEmailChangeVerificationEmail).toHaveBeenCalledWith(
        'new@example.com',
        'Test User',
        'http://localhost:5173/confirm-email-change?token=signed-token',
      );
      expect(mailService.sendEmailChangeNoticeEmail).toHaveBeenCalledWith(
        'old@example.com',
        'Test User',
        'new@example.com',
      );
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'EMAIL_CHANGE_REQUESTED',
        resource: 'User',
        resourceId: 'user-1',
        detail: 'oldEmail=old@example.com newEmail=new@example.com',
      });
    });

    it('una segunda solicitud pisa pendingEmail/token anterior con la nueva dirección (supersede)', async () => {
      config.get.mockReturnValue(undefined);

      await service.requestChange(
        { id: 'user-1', email: 'old@example.com', name: 'Test User' },
        'first@example.com',
      );
      await service.requestChange(
        { id: 'user-1', email: 'old@example.com', name: 'Test User' },
        'second@example.com',
      );

      expect(prisma.user.update).toHaveBeenLastCalledWith({
        where: { id: 'user-1' },
        data: {
          pendingEmail: 'second@example.com',
          pendingEmailTokenIssuedAt: expect.any(Date) as unknown as Date,
        },
      });
      expect(
        mailService.sendEmailChangeVerificationEmail,
      ).toHaveBeenLastCalledWith(
        'second@example.com',
        'Test User',
        expect.stringContaining('token=signed-token'),
      );
    });
  });

  describe('confirm', () => {
    it('lanza 401 si el token es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.confirm('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza 401 si el purpose del token no es email-change', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      await expect(service.confirm('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza 401 si el usuario no existe o está soft-deleted', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-change',
        pendingEmail: 'new@example.com',
        changeIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.confirm('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza 401 (replay guard) si no hay ningún cambio pendiente (token ya usado)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-change',
        pendingEmail: 'new@example.com',
        changeIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ pendingEmail: null, pendingEmailTokenIssuedAt: null }),
      );

      await expect(service.confirm('token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lanza 401 (superseded) si un pedido posterior ya reemplazó este token', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-change',
        pendingEmail: 'first@example.com',
        changeIssuedAt: 1000,
      });
      // pendingEmail/timestamp actuales corresponden a una SEGUNDA solicitud
      // posterior (distinto valor y distinto timestamp).
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          pendingEmail: 'second@example.com',
          pendingEmailTokenIssuedAt: new Date(2000),
        }),
      );

      await expect(service.confirm('token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('activa el email pendiente, marca emailVerified y limpia los campos pendientes en el camino feliz', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-change',
        pendingEmail: 'new@example.com',
        changeIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          email: 'old@example.com',
          pendingEmail: 'new@example.com',
          pendingEmailTokenIssuedAt: new Date(1000),
          emailVerified: false,
        }),
      );
      prisma.user.update.mockResolvedValue(
        buildUser({ email: 'new@example.com' }),
      );

      const result = await service.confirm('token');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          email: 'new@example.com',
          emailVerified: true,
          pendingEmail: null,
          pendingEmailTokenIssuedAt: null,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'EMAIL_CHANGE_CONFIRMED',
        resource: 'User',
        resourceId: 'user-1',
        detail: 'oldEmail=old@example.com newEmail=new@example.com',
      });
      expect(result).toEqual({
        message: 'Email actualizado correctamente.',
      });
    });

    it('lanza 409 si la dirección pendiente fue tomada por otra cuenta entre la solicitud y la confirmación', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-change',
        pendingEmail: 'new@example.com',
        changeIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          email: 'old@example.com',
          pendingEmail: 'new@example.com',
          pendingEmailTokenIssuedAt: new Date(1000),
        }),
      );
      prisma.user.update.mockRejectedValue({ code: 'P2002' });

      await expect(service.confirm('token')).rejects.toThrow(ConflictException);
    });
  });
});

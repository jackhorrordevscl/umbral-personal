import { ConflictException, BadRequestException, Logger } from '@nestjs/common';
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
  let prisma: {
    user: {
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let config: { get: jest.Mock };
  let mailService: {
    sendEmailChangeVerificationEmail: jest.Mock;
    sendEmailChangeNoticeEmail: jest.Mock;
    sendEmailChangeTakenNoticeEmail: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
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
      sendEmailChangeTakenNoticeEmail: jest.fn().mockResolvedValue(undefined),
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

    // Judgment-day #499: si la dirección pedida ya tiene cuenta, el pedido es
    // indistinguible para quien lo hace (mismo estado pendiente, mismo aviso a
    // su casilla actual, sin error); el titular de esa dirección recibe un
    // aviso en lugar del enlace, que nunca se firma.
    describe('si la dirección pedida ya pertenece a otra cuenta', () => {
      const requester = {
        id: 'user-1',
        email: 'old@example.com',
        name: 'Test User',
      };

      beforeEach(() => {
        prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });
      });

      it('busca la dirección canónica en otras cuentas', async () => {
        await service.requestChange(requester, '  Taken@Example.COM ');

        expect(prisma.user.findFirst).toHaveBeenCalledWith({
          where: { email: 'taken@example.com', id: { not: 'user-1' } },
          select: { id: true },
        });
      });

      it('guarda el pedido pendiente igual que en el camino normal', async () => {
        await service.requestChange(requester, 'taken@example.com');

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          data: {
            pendingEmail: 'taken@example.com',
            pendingEmailTokenIssuedAt: expect.any(Date) as unknown as Date,
          },
        });
      });

      it('no firma token ni envía el enlace; avisa al titular de la dirección', async () => {
        await service.requestChange(requester, 'taken@example.com');

        expect(jwtService.sign).not.toHaveBeenCalled();
        expect(
          mailService.sendEmailChangeVerificationEmail,
        ).not.toHaveBeenCalled();
        expect(
          mailService.sendEmailChangeTakenNoticeEmail,
        ).toHaveBeenCalledWith('taken@example.com');
      });

      it('avisa a la casilla actual y audita igual que en el camino normal, sin lanzar', async () => {
        await expect(
          service.requestChange(requester, 'taken@example.com'),
        ).resolves.toBeUndefined();

        expect(mailService.sendEmailChangeNoticeEmail).toHaveBeenCalledWith(
          'old@example.com',
          'Test User',
          'taken@example.com',
        );
        expect(auditService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'EMAIL_CHANGE_REQUESTED',
            userId: 'user-1',
          }),
        );
      });

      it('si falla un correo, cancela el pedido como en el camino normal', async () => {
        mailService.sendEmailChangeTakenNoticeEmail.mockRejectedValue(
          new Error('mail provider down'),
        );

        await expect(
          service.requestChange(requester, 'taken@example.com'),
        ).rejects.toThrow('mail provider down');

        expect(prisma.user.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'user-1',
            pendingEmailTokenIssuedAt: expect.any(Date) as unknown as Date,
          },
          data: { pendingEmail: null, pendingEmailTokenIssuedAt: null },
        });
      });
    });

    // Judgment-day #499: los dos correos salen en secuencia. Si cualquiera
    // falla, el pedido pendiente se cancela (compare-and-set sobre el
    // timestamp de ESTE pedido): sin eso queda un cambio abierto cuyo dueño
    // no se enteró, o un enlace enviado de un pedido que respondió 500.
    describe('si falla un correo', () => {
      const requester = {
        id: 'user-1',
        email: 'old@example.com',
        name: 'Test User',
      };

      it('cancela el pedido pendiente si falla el correo de verificación, sin avisar al dueño ni auditar', async () => {
        mailService.sendEmailChangeVerificationEmail.mockRejectedValue(
          new Error('mail provider down'),
        );

        await expect(
          service.requestChange(requester, 'new@example.com'),
        ).rejects.toThrow('mail provider down');

        expect(prisma.user.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'user-1',
            pendingEmailTokenIssuedAt: expect.any(Date) as unknown as Date,
          },
          data: { pendingEmail: null, pendingEmailTokenIssuedAt: null },
        });
        expect(mailService.sendEmailChangeNoticeEmail).not.toHaveBeenCalled();
        expect(auditService.log).not.toHaveBeenCalled();
      });

      it('cancela el pedido pendiente si falla el aviso a la dirección actual (el enlace ya enviado deja de servir)', async () => {
        mailService.sendEmailChangeNoticeEmail.mockRejectedValue(
          new Error('mail provider down'),
        );

        await expect(
          service.requestChange(requester, 'new@example.com'),
        ).rejects.toThrow('mail provider down');

        expect(mailService.sendEmailChangeVerificationEmail).toHaveBeenCalled();
        expect(prisma.user.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'user-1',
            pendingEmailTokenIssuedAt: expect.any(Date) as unknown as Date,
          },
          data: { pendingEmail: null, pendingEmailTokenIssuedAt: null },
        });
        expect(auditService.log).not.toHaveBeenCalled();
      });

      it('cancela solo el pedido propio: el timestamp del where es el que se firmó en el token', async () => {
        mailService.sendEmailChangeVerificationEmail.mockRejectedValue(
          new Error('mail provider down'),
        );

        await expect(
          service.requestChange(requester, 'new@example.com'),
        ).rejects.toThrow();

        const [updateArg] = prisma.user.update.mock.calls[0] as [
          { data: { pendingEmailTokenIssuedAt: Date } },
        ];
        const [cancelArg] = prisma.user.updateMany.mock.calls[0] as [
          { where: { pendingEmailTokenIssuedAt: Date } },
        ];
        expect(cancelArg.where.pendingEmailTokenIssuedAt).toBe(
          updateArg.data.pendingEmailTokenIssuedAt,
        );
      });

      it('si la cancelación también falla, propaga el error original del correo y deja registro', async () => {
        const loggerError = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        mailService.sendEmailChangeVerificationEmail.mockRejectedValue(
          new Error('mail provider down'),
        );
        prisma.user.updateMany.mockRejectedValue(new Error('base caída'));

        await expect(
          service.requestChange(requester, 'new@example.com'),
        ).rejects.toThrow('mail provider down');

        expect(loggerError).toHaveBeenCalledWith(
          expect.stringContaining('base caída'),
        );
        loggerError.mockRestore();
      });
    });

    // Judgment-day #499: la solicitud ya quedó guardada y los correos ya
    // salieron cuando se audita; un fallo de la auditoría no puede convertir
    // eso en un 500 (el usuario reintentaría sobre un pedido que sí existe).
    it('responde OK aunque la auditoría falle (los correos ya salieron)', async () => {
      const loggerError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      auditService.log.mockRejectedValue(new Error('audit down'));

      await expect(
        service.requestChange(
          { id: 'user-1', email: 'old@example.com', name: 'Test User' },
          'new@example.com',
        ),
      ).resolves.toBeUndefined();

      expect(mailService.sendEmailChangeVerificationEmail).toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('EMAIL_CHANGE_REQUESTED'),
        expect.anything(),
      );
      loggerError.mockRestore();
    });

    it('guarda y envía pendingEmail en forma canónica (issue #303)', async () => {
      await service.requestChange(
        { id: 'user-1', email: 'old@example.com', name: 'Test User' },
        '  New@Example.COM ',
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          pendingEmail: 'new@example.com',
          pendingEmailTokenIssuedAt: expect.any(Date) as unknown as Date,
        },
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ pendingEmail: 'new@example.com' }),
        { expiresIn: '24h' },
      );
      expect(mailService.sendEmailChangeVerificationEmail).toHaveBeenCalledWith(
        'new@example.com',
        'Test User',
        expect.any(String) as unknown as string,
      );
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
    it('lanza 400 si el token es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.confirm('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza 400 si el purpose del token no es email-change', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      await expect(service.confirm('token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza 400 si el usuario no existe o está soft-deleted', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'email-change',
        pendingEmail: 'new@example.com',
        changeIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.confirm('token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza 400 (replay guard) si no hay ningún cambio pendiente (token ya usado)', async () => {
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
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lanza 400 (superseded) si un pedido posterior ya reemplazó este token', async () => {
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
        BadRequestException,
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

      const result = await service.confirm('token');

      // Compare-and-set: el UPDATE solo aplica si el estado pendiente sigue
      // siendo el que validó el token (una contraseña cambiada o una nueva
      // solicitud entre el SELECT y el UPDATE lo invalida).
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'user-1',
          pendingEmail: 'new@example.com',
          pendingEmailTokenIssuedAt: new Date(1000),
        },
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

    // Judgment-day #499: el email ya cambió y el token ya no sirve cuando se
    // audita; si la auditoría lanzara, el usuario vería un 500 y su
    // reintento, "ya utilizado", con el cambio ya aplicado.
    it('confirma el cambio y responde OK aunque la auditoría falle', async () => {
      const loggerError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
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
      auditService.log.mockRejectedValue(new Error('audit down'));

      await expect(service.confirm('token')).resolves.toEqual({
        message: 'Email actualizado correctamente.',
      });

      expect(prisma.user.updateMany).toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('EMAIL_CHANGE_CONFIRMED'),
        expect.anything(),
      );
      loggerError.mockRestore();
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
      prisma.user.updateMany.mockRejectedValue({ code: 'P2002' });

      await expect(service.confirm('token')).rejects.toThrow(ConflictException);
    });

    it('rechaza como ya utilizado, sin auditar, si el estado pendiente cambió entre la lectura y la escritura (carrera con cambio de contraseña)', async () => {
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
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirm('token')).rejects.toThrow(
        'Token de confirmación inválido o ya utilizado',
      );
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});

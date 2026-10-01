import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Prisma, Role, User } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';

jest.mock('argon2');

const mockArgon2 = argon2 as jest.Mocked<typeof argon2>;

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

// Deja correr las promesas encoladas del trabajo fire-and-forget (issue #303)
// antes de afirmar sobre sus efectos.
const flushBackground = () => new Promise((resolve) => setImmediate(resolve));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
    invitationCode: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    session: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let config: { get: jest.Mock };
  let mailService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      invitationCode: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      // $transaction soporta las dos formas que usa AuthService: el
      // array-form (ops ya construidas de antemano, se resuelve con
      // Promise.all) y la forma interactiva usada por signup()
      // ($transaction(async (tx) => {...})), donde alcanza con invocar el
      // callback pasándole el mismo mock de `prisma` como `tx` -- los
      // mocks individuales de arriba ya devuelven promesas resueltas.
      $transaction: jest.fn(
        (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
          typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
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
    const validInvitation = {
      id: 'invitation-1',
      code: 'valid-code',
      createdById: 'creator-1',
      usedById: null,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };

    describe('auditoría (issue #283)', () => {
      const dto = {
        email: 'user@example.com',
        password: 'password1',
        name: 'Nueva Cuenta',
        inviteCode: 'valid-code',
      };

      it('registra CREATE sobre User con IP y user-agent al crear la cuenta', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
        mockArgon2.hash.mockResolvedValue('hashed-password' as never);
        prisma.user.create.mockResolvedValue(
          buildUser({ id: 'user-9', emailVerified: false }),
        );
        prisma.invitationCode.updateMany.mockResolvedValue({ count: 1 });

        await service.signup(dto, '10.0.0.1', 'jest-agent');

        expect(auditService.log).toHaveBeenCalledWith({
          userId: 'user-9',
          action: 'CREATE',
          resource: 'User',
          resourceId: 'user-9',
          detail: 'SIGNUP invitationId=invitation-1',
          ipAddress: '10.0.0.1',
          userAgent: 'jest-agent',
        });
      });

      it('registra UNAUTHORIZED_ATTEMPT sin email ni código si la invitación es inválida', async () => {
        prisma.invitationCode.findUnique.mockResolvedValue(null);

        await expect(service.signup(dto, '10.0.0.1')).rejects.toThrow(
          UnauthorizedException,
        );

        expect(auditService.log).toHaveBeenCalledTimes(1);
        const [entry] = auditService.log.mock.calls[0] as [
          Record<string, string>,
        ];
        expect(entry).toMatchObject({
          action: 'UNAUTHORIZED_ATTEMPT',
          resource: 'Signup',
          detail: 'INVITATION_INVALID',
          ipAddress: '10.0.0.1',
        });
        expect(JSON.stringify(entry)).not.toContain('user@example.com');
        expect(JSON.stringify(entry)).not.toContain('valid-code');
      });

      it('registra el motivo EMAIL_TAKEN si el email ya existe', async () => {
        prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
        prisma.user.findUnique.mockResolvedValue(buildUser());
        mockArgon2.hash.mockResolvedValue('hashed-password' as never);

        await expect(service.signup(dto)).rejects.toThrow(
          UnauthorizedException,
        );

        expect(auditService.log).toHaveBeenCalledWith(
          expect.objectContaining({ detail: 'EMAIL_TAKEN' }) as unknown,
        );
      });

      it('un fallo de la escritura de auditoría no rompe el signup (fail-open)', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
        mockArgon2.hash.mockResolvedValue('hashed-password' as never);
        prisma.user.create.mockResolvedValue(
          buildUser({ emailVerified: false }),
        );
        prisma.invitationCode.updateMany.mockResolvedValue({ count: 1 });
        auditService.log.mockRejectedValue(new Error('audit down'));

        await expect(service.signup(dto)).resolves.toHaveProperty('message');
      });
    });

    // Issue #303: email ya registrado + invitación válida responde igual que
    // una invitación inválida (mismo status y mensaje), sin crear nada.
    it('lanza 401 con el mismo mensaje genérico si el email ya está registrado', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
      prisma.user.findUnique.mockResolvedValue(buildUser());
      mockArgon2.hash.mockResolvedValue('hashed-password' as never);

      const dto = {
        email: 'user@example.com',
        password: 'password1',
        name: 'Nueva Cuenta',
        inviteCode: 'valid-code',
      };
      await expect(service.signup(dto)).rejects.toThrow(UnauthorizedException);
      await expect(service.signup(dto)).rejects.toThrow(
        'Código de invitación inválido o expirado',
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('guarda el email en forma canónica al crear la cuenta (issue #303)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
      mockArgon2.hash.mockResolvedValue('hashed-password' as never);
      prisma.user.create.mockResolvedValue(buildUser({ emailVerified: false }));
      prisma.invitationCode.updateMany.mockResolvedValue({ count: 1 });

      await service.signup({
        email: ' Ana@Example.COM ',
        password: 'password1',
        name: 'Ana',
        inviteCode: 'valid-code',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'ana@example.com' },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'ana@example.com',
        }) as unknown as Record<string, unknown>,
      });
    });

    it('valida la invitación antes de consultar si el email existe (sin invitación válida no hay oráculo de emails)', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(
        service.signup({
          email: 'user@example.com',
          password: 'password1',
          name: 'Nueva Cuenta',
          inviteCode: 'no-existe',
        }),
      ).rejects.toThrow('Código de invitación inválido o expirado');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('lanza el mismo 401 genérico si el unique de email salta dentro de la transacción (signups concurrentes)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
      mockArgon2.hash.mockResolvedValue('hashed-password' as never);
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const attempt = service.signup({
        email: 'user@example.com',
        password: 'password1',
        name: 'Test User',
        inviteCode: 'valid-code',
      });
      await expect(attempt).rejects.toThrow(UnauthorizedException);
      await expect(attempt).rejects.toThrow(
        'Código de invitación inválido o expirado',
      );
    });

    it('no enmascara otros errores de la transacción', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
      mockArgon2.hash.mockResolvedValue('hashed-password' as never);
      prisma.user.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.signup({
          email: 'user@example.com',
          password: 'password1',
          name: 'Test User',
          inviteCode: 'valid-code',
        }),
      ).rejects.toThrow('db down');
    });

    // Issue #124: signup público sin invitación. Sin un InvitationCode
    // válido (existente, sin usar, no expirado) no se puede crear cuenta --
    // el email libre no alcanza.
    it('lanza 401 si el código de invitación no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue(null);

      await expect(
        service.signup({
          email: 'user@example.com',
          password: 'password1',
          name: 'Test User',
          inviteCode: 'no-existe',
        }),
      ).rejects.toThrow('Código de invitación inválido o expirado');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('lanza 401 si el código de invitación ya fue usado', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue({
        ...validInvitation,
        usedById: 'other-user',
      });

      await expect(
        service.signup({
          email: 'user@example.com',
          password: 'password1',
          name: 'Test User',
          inviteCode: 'valid-code',
        }),
      ).rejects.toThrow('Código de invitación inválido o expirado');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('lanza 401 si el código de invitación está expirado', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue({
        ...validInvitation,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(
        service.signup({
          email: 'user@example.com',
          password: 'password1',
          name: 'Test User',
          inviteCode: 'valid-code',
        }),
      ).rejects.toThrow('Código de invitación inválido o expirado');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('crea la cuenta con emailVerified=false, marca la invitación usada y envía el email de verificación', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
      mockArgon2.hash.mockResolvedValue('hashed-password' as never);
      prisma.user.create.mockResolvedValue(buildUser({ emailVerified: false }));
      prisma.invitationCode.updateMany.mockResolvedValue({ count: 1 });
      config.get.mockImplementation((key: string) =>
        key === 'FRONTEND_URL' ? 'http://localhost:5173' : undefined,
      );

      const result = await service.signup({
        email: 'user@example.com',
        password: 'password1',
        name: 'Test User',
        inviteCode: 'valid-code',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'user@example.com',
          passwordHash: 'hashed-password',
          name: 'Test User',
          emailVerified: false,
        },
      });
      expect(prisma.invitationCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'invitation-1', usedById: null },
        data: {
          usedById: 'user-1',
          usedAt: expect.any(Date) as unknown as Date,
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
        message:
          'Cuenta creada. Revisa tu email para verificarla antes de iniciar sesión.',
      });
    });

    it('lanza 401 si dos signups concurrentes consumen el mismo código (updateMany no encuentra la fila sin usar)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitationCode.findUnique.mockResolvedValue(validInvitation);
      mockArgon2.hash.mockResolvedValue('hashed-password' as never);
      prisma.user.create.mockResolvedValue(buildUser({ emailVerified: false }));
      // El otro signup concurrente ya puso usedById -- el updateMany de este
      // signup no matchea ninguna fila (count 0).
      prisma.invitationCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.signup({
          email: 'user@example.com',
          password: 'password1',
          name: 'Test User',
          inviteCode: 'valid-code',
        }),
      ).rejects.toThrow('Código de invitación inválido o expirado');
    });
  });

  describe('createInvitation', () => {
    const requestUser = {
      id: 'creator-1',
      email: 'creador@example.com',
      role: 'PROFESSIONAL',
      name: 'Creador',
    };

    it('lanza 403 si el email del usuario no es INVITE_CREATOR_EMAIL', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'INVITE_CREATOR_EMAIL' ? 'otro@example.com' : undefined,
      );

      await expect(service.createInvitation(requestUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.invitationCode.create).not.toHaveBeenCalled();
    });

    it('lanza 403 si INVITE_CREATOR_EMAIL no está configurado', async () => {
      config.get.mockReturnValue(undefined);

      await expect(service.createInvitation(requestUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('compara INVITE_CREATOR_EMAIL sin distinguir mayúsculas ni espacios (issue #303)', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'INVITE_CREATOR_EMAIL' ? ' Creador@Example.com ' : undefined,
      );
      prisma.invitationCode.create.mockResolvedValue({
        id: 'invitation-1',
        code: 'abc123',
        expiresAt: new Date('2026-09-16T00:00:00.000Z'),
      });

      await expect(service.createInvitation(requestUser)).resolves.toEqual(
        expect.objectContaining({ code: 'abc123' }),
      );
    });

    it('crea la invitación y audita CREATE en el camino feliz', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'INVITE_CREATOR_EMAIL' ? 'creador@example.com' : undefined,
      );
      prisma.invitationCode.create.mockResolvedValue({
        id: 'invitation-1',
        code: 'abc123',
        expiresAt: new Date('2026-09-16T00:00:00.000Z'),
      });

      const result = await service.createInvitation(requestUser);

      expect(prisma.invitationCode.create).toHaveBeenCalledWith({
        data: {
          code: expect.any(String) as unknown as string,
          createdById: 'creator-1',
          expiresAt: expect.any(Date) as unknown as Date,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'creator-1',
        action: 'CREATE',
        resource: 'InvitationCode',
        resourceId: 'invitation-1',
      });
      expect(result).toEqual({
        code: 'abc123',
        expiresAt: new Date('2026-09-16T00:00:00.000Z'),
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

    it('corre un argon2.verify dummy si el usuario no existe (cierra el timing oracle)', async () => {
      // getDummyPasswordHash() cachea el hash dummy una sola vez a nivel de
      // módulo (por diseño: se calcula una vez, no en cada request), así que
      // no podemos afirmar CUÁL valor exacto usó -- eso depende de qué mock
      // de argon2.hash estuviera activo la primera vez que se llamó en todo
      // este archivo de test. Lo que sí es estable y es lo que realmente
      // importa para cerrar el timing oracle: que argon2.verify se invoque
      // igual en la rama "usuario no existe" que en la de un usuario real,
      // en vez de retornar 401 de inmediato sin correr ningún hash.
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'no@example.com', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockArgon2.verify).toHaveBeenCalledTimes(1);
      expect(mockArgon2.verify).toHaveBeenCalledWith(
        expect.anything(),
        'password1',
      );
    });

    it('lanza 401 si el usuario está soft-deleted (deletedAt seteado)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ deletedAt: new Date() }),
      );

      await expect(
        service.login({ email: 'user@example.com', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('busca la cuenta por el email recortado y en minúsculas (issue #303)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: ' User@Example.COM ', password: 'password1' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
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

    describe('auditoría de intentos fallidos (issue #283)', () => {
      const flush = () => new Promise((resolve) => setImmediate(resolve));

      it('registra LOGIN_FAILED con ip y user-agent si la contraseña es incorrecta, sin la contraseña ni el email', async () => {
        prisma.user.findUnique.mockResolvedValue(buildUser());
        mockArgon2.verify.mockResolvedValue(false as never);

        await expect(
          service.login(
            { email: 'user@example.com', password: 'wrong-pass' },
            '203.0.113.7',
            'jest-agent',
          ),
        ).rejects.toThrow('Credenciales inválidas');
        await flush();

        expect(auditService.log).toHaveBeenCalledTimes(1);
        const entry = (
          auditService.log.mock.calls as Array<[Record<string, string>]>
        )[0][0];
        expect(entry).toMatchObject({
          userId: 'user-1',
          action: 'LOGIN_FAILED',
          resource: 'Auth',
          resourceId: 'user-1',
          ipAddress: '203.0.113.7',
          userAgent: 'jest-agent',
        });
        expect(JSON.stringify(entry)).not.toContain('wrong-pass');
        expect(JSON.stringify(entry)).not.toContain('user@example.com');
      });

      it('no registra nada si el usuario no existe o está soft-deleted (no filtra existencia)', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        await expect(
          service.login({ email: 'no@example.com', password: 'password1' }),
        ).rejects.toThrow('Credenciales inválidas');

        prisma.user.findUnique.mockResolvedValue(
          buildUser({ deletedAt: new Date() }),
        );
        await expect(
          service.login({ email: 'user@example.com', password: 'password1' }),
        ).rejects.toThrow('Credenciales inválidas');
        await flush();

        expect(auditService.log).not.toHaveBeenCalled();
      });

      it('un fallo al registrar no cambia la excepción 401 (fail-open)', async () => {
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        auditService.log.mockRejectedValue(new Error('DB caída'));
        prisma.user.findUnique.mockResolvedValue(buildUser());
        mockArgon2.verify.mockResolvedValue(false as never);

        await expect(
          service.login({ email: 'user@example.com', password: 'wrong-pass' }),
        ).rejects.toThrow(UnauthorizedException);
        await flush();

        expect(errorSpy).toHaveBeenCalledTimes(1);
        errorSpy.mockRestore();
      });

      it('no registra LOGIN_FAILED cuando la contraseña es correcta', async () => {
        prisma.user.findUnique.mockResolvedValue(buildUser());
        mockArgon2.verify.mockResolvedValue(true as never);

        await service.login({
          email: 'user@example.com',
          password: 'password1',
        });
        await flush();

        expect(auditService.log).not.toHaveBeenCalled();
      });
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
      prisma.user.findUnique.mockResolvedValue(buildUser({ mfaEnabled: true }));
      mockArgon2.verify.mockResolvedValue(true as never);

      const result = await service.login({
        email: 'user@example.com',
        password: 'password1',
      });

      expect(result).toEqual({ requiresMfa: true, mfaToken: 'signed-token' });
      expect(result).not.toHaveProperty('userId');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', purpose: 'mfa-verify' },
        { expiresIn: '5m' },
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

    it('cambia la contraseña, limpia el flag, setea passwordChangedAt, audita PASSWORD_CHANGED y delega en completeLogin (MFA obligatorio: requiresMfaSetup)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-change',
      });
      const user = buildUser({ mustChangePassword: true });
      prisma.user.findUnique.mockResolvedValue(user);
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);
      const result = await service.changePassword({
        passwordChangeToken,
        newPassword: 'newpassword1',
      });

      expect(mockArgon2.hash).toHaveBeenCalledWith('newpassword1');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', mustChangePassword: true },
        data: {
          passwordHash: 'new-hashed-password',
          mustChangePassword: false,
          passwordChangedAt: expect.any(Date) as unknown as Date,
          pendingEmail: null,
          pendingEmailTokenIssuedAt: null,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'PASSWORD_CHANGED',
        resource: 'User',
        resourceId: 'user-1',
        detail: expect.not.stringContaining(
          'newpassword1',
        ) as unknown as string,
      });
      expect(result).toEqual({
        requiresMfaSetup: true,
        setupToken: 'signed-token',
      });
    });

    it('limpia un pendingEmail existente al completar el cambio forzado (issue #76, PR B: si un atacante con el token robado dejó un cambio de email pendiente, el dueño real lo cancela al cambiar la contraseña)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-change',
      });
      const user = buildUser({
        mustChangePassword: true,
        pendingEmail: 'attacker@evil.com',
        pendingEmailTokenIssuedAt: new Date(),
      });
      prisma.user.findUnique.mockResolvedValue(user);
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);
      await service.changePassword({
        passwordChangeToken,
        newPassword: 'newpassword1',
      });

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', mustChangePassword: true },
        data: expect.objectContaining({
          pendingEmail: null,
          pendingEmailTokenIssuedAt: null,
        }) as unknown as Record<string, unknown>,
      });
    });

    it('lanza 401 y no audita si un cambio concurrente ya consumió el flag (updateMany no encuentra la fila, issue #302)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-change',
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ mustChangePassword: true }),
      );
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.changePassword({
          passwordChangeToken,
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('La contraseña ya fue actualizada anteriormente');
      expect(auditService.log).not.toHaveBeenCalled();
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
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ deletedAt: new Date() }),
      );

      const result = await service.forgotPassword({
        email: 'user@example.com',
      });

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

      const result = await service.forgotPassword({
        email: 'user@example.com',
      });
      await flushBackground();

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordResetTokenIssuedAt: expect.any(Date) as unknown as Date,
        },
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

  // Issue #303: el trabajo posterior a la respuesta corre en segundo plano.
  describe('trabajo en segundo plano (issue #303)', () => {
    const forgotDto = { email: 'user@example.com' };
    let loggerError: jest.SpiedFunction<typeof Logger.prototype.error>;

    beforeEach(() => {
      loggerError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      loggerError.mockRestore();
    });

    it('forgotPassword responde sin esperar el UPDATE, el email ni el audit', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.user.update.mockReturnValue(new Promise(() => undefined));

      const result = await service.forgotPassword(forgotDto);

      expect(result).toEqual({
        message:
          'Si el email está registrado, vas a recibir un enlace para restablecer tu contraseña.',
      });
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('forgotPassword hace el mismo trabajo síncrono (un findUnique) para cuenta existente e inexistente', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await service.forgotPassword(forgotDto);
      await flushBackground();
      const callsMissing = prisma.user.findUnique.mock.calls.length;

      prisma.user.findUnique.mockClear();
      prisma.user.findUnique.mockResolvedValue(buildUser());
      await service.forgotPassword(forgotDto);
      await flushBackground();

      expect(callsMissing).toBe(1);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('forgotPassword registra (sin lanzar ni exponer el email) si el envío falla en segundo plano', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      mailService.sendPasswordResetEmail.mockRejectedValue(
        new Error('resend down'),
      );

      await expect(service.forgotPassword(forgotDto)).resolves.toBeDefined();
      await flushBackground();

      expect(loggerError).toHaveBeenCalledTimes(1);
      const logged = String(loggerError.mock.calls[0]?.[0]);
      expect(logged).toContain('resend down');
      expect(logged).toContain('user-1');
      expect(logged).not.toContain('user@example.com');
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('forgotPassword registra si el UPDATE falla en segundo plano', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      prisma.user.update.mockRejectedValue(new Error('db down'));

      await expect(service.forgotPassword(forgotDto)).resolves.toBeDefined();
      await flushBackground();

      expect(loggerError).toHaveBeenCalledTimes(1);
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    describe('resendVerificationEmail', () => {
      const dto = { email: 'user@example.com' };
      const generic = {
        message:
          'Si el email está registrado y pendiente de verificar, vas a recibir un nuevo enlace.',
      };

      it.each([
        ['no existe', null],
        ['está soft-deleted', buildUser({ deletedAt: new Date() })],
        ['ya está verificado', buildUser({ emailVerified: true })],
      ])(
        'responde el mensaje genérico sin enviar nada si la cuenta %s',
        async (_label, user) => {
          prisma.user.findUnique.mockResolvedValue(user);

          const result = await service.resendVerificationEmail(dto);
          await flushBackground();

          expect(result).toEqual(generic);
          expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
        },
      );

      it('envía el link en segundo plano si la cuenta está pendiente de verificar', async () => {
        prisma.user.findUnique.mockResolvedValue(
          buildUser({ emailVerified: false }),
        );
        config.get.mockImplementation((key: string) =>
          key === 'FRONTEND_URL' ? 'http://localhost:5173' : undefined,
        );
        mailService.sendVerificationEmail.mockReturnValue(
          new Promise(() => undefined),
        );

        const result = await service.resendVerificationEmail(dto);
        await flushBackground();

        expect(result).toEqual(generic);
        expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
          'user@example.com',
          'Test User',
          'http://localhost:5173/verify-email?token=signed-token',
        );
      });

      it('registra (sin lanzar ni exponer el email) si el envío falla en segundo plano', async () => {
        prisma.user.findUnique.mockResolvedValue(
          buildUser({ emailVerified: false }),
        );
        mailService.sendVerificationEmail.mockRejectedValue(
          new Error('resend down'),
        );

        await expect(service.resendVerificationEmail(dto)).resolves.toEqual(
          generic,
        );
        await flushBackground();

        expect(loggerError).toHaveBeenCalledTimes(1);
        const logged = String(loggerError.mock.calls[0]?.[0]);
        expect(logged).toContain('resend down');
        expect(logged).not.toContain('user@example.com');
      });
    });
  });

  describe('logout / logoutAll (issue #192)', () => {
    const reqUser = {
      id: 'user-1',
      email: 'u@example.com',
      role: 'PROFESSIONAL',
      name: 'U',
      jti: 'jti-1',
    };

    it('logout revoca solo la Session del jti actual y deja auditoría LOGOUT', async () => {
      await service.logout(reqUser, '10.0.0.1', 'agent');

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { jti: 'jti-1', userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as Date },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'LOGOUT',
          resourceId: 'jti-1',
          ipAddress: '10.0.0.1',
          userAgent: 'agent',
        }),
      );
    });

    it('logoutAll revoca todas las Sessions activas del usuario y deja auditoría LOGOUT_ALL', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.logoutAll(reqUser);

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as Date },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'LOGOUT_ALL',
          detail: 'Sesiones revocadas: 3',
        }),
      );
      expect(result).toEqual({ message: 'Sesiones cerradas', revoked: 3 });
    });
  });

  describe('resetPassword', () => {
    it('lanza 401 si el token es inválido o expiró', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.resetPassword({
          resetToken: 'bad-token',
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Token de restablecimiento inválido o expirado');
    });

    it('lanza 401 si el purpose del token no es password-reset', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      await expect(
        service.resetPassword({
          resetToken: 'token',
          newPassword: 'newpassword1',
        }),
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
        service.resetPassword({
          resetToken: 'token',
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Usuario no válido');
    });

    it('lanza 401 (replay guard) si el timestamp no coincide con el guardado', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: new Date(2000) }),
      );

      await expect(
        service.resetPassword({
          resetToken: 'token',
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Token de restablecimiento inválido o ya utilizado');
    });

    it('audita UNAUTHORIZED_ATTEMPT con ip y user-agent si el token ya fue usado (usuario conocido)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: null }),
      );

      await expect(
        service.resetPassword(
          { resetToken: 'token', newPassword: 'newpassword1' },
          '203.0.113.7',
          'jest-agent',
        ),
      ).rejects.toThrow('Token de restablecimiento inválido o ya utilizado');

      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'UNAUTHORIZED_ATTEMPT',
          ipAddress: '203.0.113.7',
          userAgent: 'jest-agent',
        }),
      );
    });

    it('no audita si el token no verifica (sin userId confiable)', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.resetPassword({
          resetToken: 'bad-token',
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Token de restablecimiento inválido o expirado');

      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('lanza 401 (replay guard) si ya no hay ningún reset pendiente (token ya usado)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: null }),
      );

      await expect(
        service.resetPassword({
          resetToken: 'token',
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Token de restablecimiento inválido o ya utilizado');
    });

    it('resetea la contraseña, limpia el timestamp, setea passwordChangedAt y no emite accessToken en el camino feliz', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: new Date(1000) }),
      );
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);

      const result = await service.resetPassword({
        resetToken: 'token',
        newPassword: 'newpassword1',
      });

      expect(mockArgon2.hash).toHaveBeenCalledWith('newpassword1');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', passwordResetTokenIssuedAt: new Date(1000) },
        data: {
          passwordHash: 'new-hashed-password',
          passwordResetTokenIssuedAt: null,
          passwordChangedAt: expect.any(Date) as unknown as Date,
          pendingEmail: null,
          pendingEmailTokenIssuedAt: null,
        },
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'PASSWORD_RESET_COMPLETED',
        resource: 'User',
        resourceId: 'user-1',
      });
      // Issue #76 (PR B): además del audit específico de reset, se registra
      // el genérico PASSWORD_CHANGED -- mismo trail que usan PATCH /profile
      // y el completion de mustChangePassword, para tener un único punto de
      // consulta de "cuándo cambió la contraseña de esta cuenta".
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'PASSWORD_CHANGED',
        resource: 'User',
        resourceId: 'user-1',
        detail: expect.not.stringContaining(
          'newpassword1',
        ) as unknown as string,
      });
      expect(auditService.log).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        message: 'Contraseña actualizada. Ya puedes iniciar sesión.',
      });
    });

    it('limpia un pendingEmail existente al resetear la contraseña vía forgot-password (issue #76, PR B: si un atacante con un token robado dejó un cambio de email pendiente, la víctima lo cancela al resetear su contraseña)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({
          passwordResetTokenIssuedAt: new Date(1000),
          pendingEmail: 'attacker@evil.com',
          pendingEmailTokenIssuedAt: new Date(),
        }),
      );
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);

      await service.resetPassword({
        resetToken: 'token',
        newPassword: 'newpassword1',
      });

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'user-1',
        }) as unknown as Record<string, unknown>,
        data: expect.objectContaining({
          pendingEmail: null,
          pendingEmailTokenIssuedAt: null,
        }) as unknown as Record<string, unknown>,
      });
    });

    it('lanza 401 y solo audita el intento rechazado si un reset concurrente ya consumió el token (updateMany no encuentra la fila, issue #302)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'password-reset',
        resetIssuedAt: 1000,
      });
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordResetTokenIssuedAt: new Date(1000) }),
      );
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resetPassword({
          resetToken: 'token',
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow('Token de restablecimiento inválido o ya utilizado');
      // Solo el intento rechazado: nunca PASSWORD_RESET_COMPLETED/PASSWORD_CHANGED.
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UNAUTHORIZED_ATTEMPT' }),
      );
    });
  });
});

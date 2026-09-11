import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as fs from 'fs/promises';
import { User } from '@prisma/client';
import { ProfileService } from './profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailChangeService } from './email-change.service';
import { AuditService } from '../audit/audit.service';
import { assertFileContentMatchesMimetype } from '../../common/utils/file-signature.util';

jest.mock('argon2');
jest.mock('fs/promises');
jest.mock('../../common/utils/file-signature.util');

const mockArgon2 = argon2 as jest.Mocked<typeof argon2>;
const mockFs = fs as jest.Mocked<typeof fs>;
const mockAssertFileContentMatchesMimetype =
  assertFileContentMatchesMimetype as jest.MockedFunction<
    typeof assertFileContentMatchesMimetype
  >;

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    passwordHash: 'hashed-password',
    mfaEnabled: false,
    pendingEmail: null,
    pendingEmailTokenIssuedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as User;
}

/**
 * Issue #76: PATCH /profile exige step-up auth (currentPassword) para
 * cualquier cambio de email/password -- name-only sigue sin necesitarla. El
 * delta de email nunca pisa `email` directo: se delega en
 * EmailChangeService.requestChange (pendingEmail diferido).
 */
describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: {
    user: { findFirst: jest.Mock; update: jest.Mock };
  };
  let emailChangeService: { requestChange: jest.Mock };
  let auditService: { log: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    emailChangeService = {
      requestChange: jest.fn().mockResolvedValue(undefined),
    };
    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    // Issue #124: sin INVITE_CREATOR_EMAIL configurado por default en los
    // tests -- cada test de canInvite lo setea explícitamente.
    config = {
      get: jest.fn().mockReturnValue(undefined),
    };

    service = new ProfileService(
      prisma as unknown as PrismaService,
      emailChangeService as unknown as EmailChangeService,
      auditService as unknown as AuditService,
      config as unknown as ConfigService,
    );

    jest.clearAllMocks();
  });

  describe('findOne', () => {
    // Issue #76 (PR B, gap encontrado en frontend): sin pendingEmail en la
    // respuesta de GET /profile, un usuario que recarga la página después de
    // pedir un cambio de email no tiene forma de saber que tiene uno
    // pendiente -- la UI depende de este campo para mostrar el banner.
    it('incluye pendingEmail en la respuesta', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({ pendingEmail: 'nuevo@example.com' }),
      );

      const result = await service.findOne('user-1');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
        select: expect.objectContaining({
          pendingEmail: true,
        }) as unknown as Record<string, boolean>,
      });
      expect(result.pendingEmail).toBe('nuevo@example.com');
    });

    // Issue #124: el frontend usa canInvite para mostrar (o no) la UI de
    // generar invitaciones -- sin rol ADMIN (decisión explícita), la única
    // fuente de verdad es que el email del usuario coincida con
    // INVITE_CREATOR_EMAIL.
    it('canInvite=true si el email del usuario coincide con INVITE_CREATOR_EMAIL', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({ email: 'creador@example.com' }),
      );
      config.get.mockReturnValue('creador@example.com');

      const result = await service.findOne('user-1');

      expect(result.canInvite).toBe(true);
    });

    it('canInvite=false si el email del usuario no coincide con INVITE_CREATOR_EMAIL', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({ email: 'user@example.com' }),
      );
      config.get.mockReturnValue('creador@example.com');

      const result = await service.findOne('user-1');

      expect(result.canInvite).toBe(false);
    });

    it('canInvite=false si INVITE_CREATOR_EMAIL no está configurado', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      config.get.mockReturnValue(undefined);

      const result = await service.findOne('user-1');

      expect(result.canInvite).toBe(false);
    });
  });

  describe('update — step-up auth', () => {
    it('lanza 401 si falta currentPassword y viene email', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());

      await expect(
        service.update('user-1', { email: 'new@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(emailChangeService.requestChange).not.toHaveBeenCalled();
    });

    it('lanza 401 si falta currentPassword y viene password', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());

      await expect(
        service.update('user-1', { password: 'NuevaPassword789!' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lanza 401 si currentPassword es incorrecta, y no cambia ni siquiera name', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      mockArgon2.verify.mockResolvedValue(false as never);

      await expect(
        service.update('user-1', {
          name: 'Nombre Nuevo',
          email: 'new@example.com',
          currentPassword: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockArgon2.verify).toHaveBeenCalledWith(
        'hashed-password',
        'wrong-password',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('un update de solo name NO requiere currentPassword', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      prisma.user.update.mockResolvedValue(buildUser({ name: 'Nombre Nuevo' }));

      const result = await service.update('user-1', {
        name: 'Nombre Nuevo',
      });

      expect(mockArgon2.verify).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'Nombre Nuevo' },
        select: expect.objectContaining({ id: true }) as unknown as Record<
          string,
          boolean
        >,
      });
      expect(result.name).toBe('Nombre Nuevo');
    });
  });

  describe('update — email delta diferido', () => {
    it('con currentPassword correcta, delega el cambio de email en EmailChangeService en vez de pisar `email`', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce(buildUser()) // fetch inicial del usuario
        .mockResolvedValueOnce(null); // uniqueness check: nadie más tiene ese email
      mockArgon2.verify.mockResolvedValue(true as never);
      prisma.user.update.mockResolvedValue(buildUser());

      const result = await service.update('user-1', {
        email: 'new@example.com',
        currentPassword: 'correct-password',
      });

      expect(emailChangeService.requestChange).toHaveBeenCalledWith(
        { id: 'user-1', email: 'user@example.com', name: 'Test User' },
        'new@example.com',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {},
        select: expect.objectContaining({ id: true }) as unknown as Record<
          string,
          boolean
        >,
      });
      // Regresión (#76 PR A, hallado en CI): el select de arriba corre ANTES
      // de que requestChange escriba pendingEmail, así que la respuesta debe
      // reflejarlo explícitamente en vez de devolver el valor stale leído.
      expect(result.pendingEmail).toBe('new@example.com');
    });

    it('lanza 409 si el email solicitado ya está registrado por otra cuenta y no delega nada', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce(buildUser())
        .mockResolvedValueOnce(buildUser({ id: 'other-user' }));
      mockArgon2.verify.mockResolvedValue(true as never);

      await expect(
        service.update('user-1', {
          email: 'taken@example.com',
          currentPassword: 'correct-password',
        }),
      ).rejects.toThrow(ConflictException);
      expect(emailChangeService.requestChange).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('pedir el mismo email ya activo es un no-op (sin delta, no delega)', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      mockArgon2.verify.mockResolvedValue(true as never);
      prisma.user.update.mockResolvedValue(buildUser());

      await service.update('user-1', {
        email: 'user@example.com',
        currentPassword: 'correct-password',
      });

      expect(emailChangeService.requestChange).not.toHaveBeenCalled();
    });
  });

  describe('update — cambio de password', () => {
    it('camino feliz: hashea la nueva password, setea passwordChangedAt y audita PASSWORD_CHANGED', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      mockArgon2.verify.mockResolvedValue(true as never);
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);
      prisma.user.update.mockResolvedValue(buildUser());

      await service.update('user-1', {
        password: 'NuevaPassword789!',
        currentPassword: 'correct-password',
      });

      expect(mockArgon2.hash).toHaveBeenCalledWith('NuevaPassword789!');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new-hashed-password',
          passwordChangedAt: expect.any(Date) as unknown as Date,
          pendingEmail: null,
          pendingEmailTokenIssuedAt: null,
        },
        select: expect.objectContaining({ id: true }) as unknown as Record<
          string,
          boolean
        >,
      });
      expect(auditService.log).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'PASSWORD_CHANGED',
        resource: 'User',
        resourceId: 'user-1',
        detail: expect.not.stringContaining(
          'NuevaPassword789!',
        ) as unknown as string,
      });
    });

    // Issue #76 (PR B): un cambio de password limpia cualquier cambio de
    // email pendiente (design.md, "Any password change also clears
    // pending") -- si alguien más pidió el cambio de email con una sesión
    // robada, el dueño real recupera la cuenta cambiando la password sin
    // depender de que el token de email-change expire solo.
    it('cambiar la password limpia un pendingEmail/pendingEmailTokenIssuedAt existente', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({
          pendingEmail: 'attacker@example.com',
          pendingEmailTokenIssuedAt: new Date(),
        }),
      );
      mockArgon2.verify.mockResolvedValue(true as never);
      mockArgon2.hash.mockResolvedValue('new-hashed-password' as never);
      prisma.user.update.mockResolvedValue(buildUser());

      await service.update('user-1', {
        password: 'NuevaPassword789!',
        currentPassword: 'correct-password',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pendingEmail: null,
            pendingEmailTokenIssuedAt: null,
          }) as unknown as Record<string, unknown>,
        }),
      );
    });

    it('un update de solo name NO audita PASSWORD_CHANGED ni toca passwordChangedAt/pendingEmail', async () => {
      prisma.user.findFirst.mockResolvedValue(buildUser());
      prisma.user.update.mockResolvedValue(buildUser());

      await service.update('user-1', { name: 'Nombre Nuevo' });

      expect(auditService.log).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'Nombre Nuevo' },
        select: expect.objectContaining({ id: true }) as unknown as Record<
          string,
          boolean
        >,
      });
    });
  });

  describe('uploadAvatar', () => {
    const file = {
      buffer: Buffer.from('fake-image-bytes'),
      mimetype: 'image/png',
    } as unknown as Express.Multer.File;

    it('valida el contenido real del archivo, guarda el buffer y actualiza avatarMimeType/avatarUpdatedAt', async () => {
      mockFs.mkdir.mockResolvedValue(undefined as never);
      mockFs.writeFile.mockResolvedValue(undefined);
      prisma.user.update.mockResolvedValue(buildUser());

      const result = await service.uploadAvatar('user-1', file);

      expect(mockAssertFileContentMatchesMimetype).toHaveBeenCalledWith(
        file.buffer,
        file.mimetype,
      );
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('avatars') as unknown as string,
        { recursive: true },
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user-1') as unknown as string,
        file.buffer,
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarMimeType: 'image/png', avatarUpdatedAt: expect.any(Date) as unknown as Date },
      });
      expect(result.avatarUpdatedAt).toBeInstanceOf(Date);
    });

    // Issue #51 (mismo criterio que DocumentsService): el mimetype declarado
    // por el cliente es spoofable, así que esta validación de contenido real
    // delega en assertFileContentMatchesMimetype -- no se duplica su lógica
    // acá, solo se comprueba que se invoca y que su throw se propaga.
    it('propaga el error de assertFileContentMatchesMimetype si el contenido no coincide con el mimetype declarado, sin escribir nada', async () => {
      mockAssertFileContentMatchesMimetype.mockImplementationOnce(() => {
        throw new Error('El contenido del archivo no coincide con el tipo declarado');
      });

      await expect(service.uploadAvatar('user-1', file)).rejects.toThrow(
        'El contenido del archivo no coincide con el tipo declarado',
      );
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getAvatar', () => {
    it('lanza 404 si el usuario no tiene avatarMimeType (nunca subió una foto)', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({ avatarMimeType: null } as Partial<User>),
      );

      await expect(service.getAvatar('user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('devuelve el buffer del archivo y el mimeType guardado', async () => {
      prisma.user.findFirst.mockResolvedValue(
        buildUser({ avatarMimeType: 'image/png' } as Partial<User>),
      );
      const buffer = Buffer.from('avatar-bytes');
      mockFs.readFile.mockResolvedValue(buffer);

      const result = await service.getAvatar('user-1');

      expect(result).toEqual({ buffer, mimeType: 'image/png' });
    });
  });

  describe('deleteAvatar', () => {
    it('borra el archivo y limpia avatarMimeType/avatarUpdatedAt', async () => {
      mockFs.unlink.mockResolvedValue(undefined);
      prisma.user.update.mockResolvedValue(buildUser());

      const result = await service.deleteAvatar('user-1');

      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('user-1') as unknown as string,
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarMimeType: null, avatarUpdatedAt: null },
      });
      expect(result).toEqual({ avatarUpdatedAt: null });
    });

    // Idempotente a propósito (ver comentario en el service): "quitar foto"
    // sin una foto previa no debe fallar (doble click, retry de red, etc.).
    it('no lanza si el archivo no existe (ENOENT) y de todos modos limpia los campos', async () => {
      const enoentError = Object.assign(new Error('no such file'), {
        code: 'ENOENT',
      });
      mockFs.unlink.mockRejectedValue(enoentError);
      prisma.user.update.mockResolvedValue(buildUser());

      const result = await service.deleteAvatar('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarMimeType: null, avatarUpdatedAt: null },
      });
      expect(result).toEqual({ avatarUpdatedAt: null });
    });

    it('propaga errores de fs que no sean ENOENT', async () => {
      const permissionError = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
      });
      mockFs.unlink.mockRejectedValue(permissionError);

      await expect(service.deleteAvatar('user-1')).rejects.toThrow(
        'permission denied',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

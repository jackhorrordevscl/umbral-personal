import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// FileInterceptor captura sus opciones al decorar el controller; se reemplaza
// para poder ejercer el fileFilter del avatar sin levantar multer.
type FileFilter = (
  req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, accept: boolean) => void,
) => void;
jest.mock('@nestjs/platform-express', () => {
  const captured: { fileFilter?: FileFilter }[] = [];
  return {
    __captured: captured,
    FileInterceptor: (_f: string, options: { fileFilter?: FileFilter }) => {
      captured.push(options);
      return class {};
    },
  };
});
const capturedOptions = jest.requireMock<{
  __captured: { fileFilter?: FileFilter }[];
}>('@nestjs/platform-express').__captured;
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

// @nestjs/throttler no exporta THROTTLER_SKIP en su API pública -- ver el
// mismo criterio en auth.controller.spec.ts.
const THROTTLER_SKIP = 'THROTTLER:SKIP';

/**
 * Issue #76: cobertura mínima de que el controller delega en ProfileService
 * sin agregar lógica propia -- el guard/throttler stack (JwtAuthGuard clase +
 * ThrottlerGuard método, ver profile.module.ts) se ejerce en
 * profile.e2e-spec.ts, no acá.
 */
describe('ProfileController', () => {
  let controller: ProfileController;
  let profileService: {
    findOne: jest.Mock;
    getMfaHistory: jest.Mock;
    update: jest.Mock;
    uploadAvatar: jest.Mock;
    getAvatar: jest.Mock;
    deleteAvatar: jest.Mock;
  };

  const user: RequestUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'PROFESSIONAL',
    name: 'Test User',
  };

  beforeEach(() => {
    profileService = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1' }),
      getMfaHistory: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'user-1' }),
      uploadAvatar: jest
        .fn()
        .mockResolvedValue({ avatarUpdatedAt: new Date() }),
      getAvatar: jest.fn().mockResolvedValue({
        buffer: Buffer.from('img'),
        mimeType: 'image/png',
      }),
      deleteAvatar: jest.fn().mockResolvedValue({ avatarUpdatedAt: null }),
    };

    controller = new ProfileController(
      profileService as unknown as ProfileService,
    );
  });

  it('GET / delega en profileService.findOne con el id del usuario autenticado', async () => {
    const result = await controller.findOne(user);

    expect(profileService.findOne).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ id: 'user-1' });
  });

  it('GET /mfa-history delega en profileService.getMfaHistory con el id del usuario autenticado', async () => {
    await controller.getMfaHistory(user);

    expect(profileService.getMfaHistory).toHaveBeenCalledWith('user-1');
  });

  it('PATCH / delega el DTO completo (incluida currentPassword) en profileService.update', async () => {
    const dto = {
      email: 'new@example.com',
      currentPassword: 'correct-password',
    };

    const result = await controller.update(dto, user);

    expect(profileService.update).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ id: 'user-1' });
  });

  it('PATCH / propaga los errores lanzados por profileService.update (401 step-up, etc.)', async () => {
    profileService.update.mockRejectedValue(
      new Error('Contraseña actual incorrecta'),
    );

    await expect(controller.update({ password: 'x' }, user)).rejects.toThrow(
      'Contraseña actual incorrecta',
    );
  });

  it('POST /avatar delega en profileService.uploadAvatar con el id del usuario autenticado y el archivo', async () => {
    const file = {
      buffer: Buffer.from('x'),
      mimetype: 'image/png',
    } as unknown as Express.Multer.File;

    const result = await controller.uploadAvatar(file, user);

    expect(profileService.uploadAvatar).toHaveBeenCalledWith('user-1', file);
    expect(result).toEqual({
      avatarUpdatedAt: expect.any(Date) as unknown as Date,
    });
  });

  // Issue #289: antes el fileFilter devolvía 500 y un body sin `file` explotaba
  // con un TypeError dentro del servicio.
  it('POST /avatar responde 400 si falta el archivo, sin llamar al servicio', () => {
    expect(() => controller.uploadAvatar(undefined, user)).toThrow(
      BadRequestException,
    );
    expect(profileService.uploadAvatar).not.toHaveBeenCalled();
  });

  it('el fileFilter del avatar rechaza un tipo no permitido con BadRequestException', () => {
    const cb = jest.fn();

    capturedOptions[0].fileFilter!({}, { mimetype: 'application/pdf' }, cb);

    const [error, accept] = cb.mock.calls[0] as [unknown, boolean];
    expect(error).toBeInstanceOf(BadRequestException);
    expect(accept).toBe(false);
  });

  it('el fileFilter del avatar acepta una imagen PNG', () => {
    const cb = jest.fn();

    capturedOptions[0].fileFilter!({}, { mimetype: 'image/png' }, cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('GET /avatar delega en profileService.getAvatar y escribe el buffer con el Content-Type correcto', async () => {
    const set = jest.fn();
    const end = jest.fn();
    const res = { set, end } as unknown as import('express').Response;

    await controller.getAvatar(user, res);

    expect(profileService.getAvatar).toHaveBeenCalledWith('user-1');
    expect(set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Content-Length': 3,
    });
    expect(end).toHaveBeenCalledWith(Buffer.from('img'));
  });

  it('DELETE /avatar delega en profileService.deleteAvatar con el id del usuario autenticado', async () => {
    const result = await controller.deleteAvatar(user);

    expect(profileService.deleteAvatar).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ avatarUpdatedAt: null });
  });

  // Bug reportado en pruebas manuales de sdd/patient-self-scheduling PR 3:
  // ThrottlerModule es @Global(), así que los dos throttlers nuevos
  // ('public-availability'/'public-booking') aplican a CUALQUIER ruta con
  // ThrottlerGuard en toda la app, no solo a AuthController -- este
  // controller quedó afuera de esa exhaustividad porque el named-throttler
  // audit de PR 3 (tasks.md 3.3) solo tocó auth.controller.ts.
  //
  // Issue #133: 'payment-confirm'/'payment-return' (buildPaymentsThrottlerOptions
  // en payments.module.ts) son otro módulo satélite más registrando su propio
  // ThrottlerModule.forRootAsync -- mismo riesgo, se cubren en la misma lista.
  describe('exhaustividad de @SkipThrottle (public-availability/public-booking/payments)', () => {
    const reflector = new Reflector();
    const foreignThrottlerNames = [
      'public-availability',
      'public-booking',
      'payment-confirm',
      'payment-return',
    ] as const;

    it.each(['update', 'uploadAvatar', 'deleteAvatar'] as const)(
      '%s saltea public-availability, public-booking, payment-confirm y payment-return',
      (methodName) => {
        const handler = (
          controller as unknown as Record<string, () => unknown>
        )[methodName];

        for (const name of foreignThrottlerNames) {
          expect(
            reflector.get<boolean | undefined>(THROTTLER_SKIP + name, handler),
          ).toBe(true);
        }
      },
    );
  });
});

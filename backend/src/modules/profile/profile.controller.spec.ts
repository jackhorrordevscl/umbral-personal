import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import type { RequestUser } from '../../common/decorators/current-user.decorator';

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
      uploadAvatar: jest.fn().mockResolvedValue({ avatarUpdatedAt: new Date() }),
      getAvatar: jest
        .fn()
        .mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/png' }),
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
    const file = { buffer: Buffer.from('x'), mimetype: 'image/png' } as unknown as Express.Multer.File;

    const result = await controller.uploadAvatar(file, user);

    expect(profileService.uploadAvatar).toHaveBeenCalledWith('user-1', file);
    expect(result).toEqual({ avatarUpdatedAt: expect.any(Date) as unknown as Date });
  });

  it('GET /avatar delega en profileService.getAvatar y escribe el buffer con el Content-Type correcto', async () => {
    const res = {
      set: jest.fn(),
      end: jest.fn(),
    } as unknown as import('express').Response;

    await controller.getAvatar(user, res);

    expect(profileService.getAvatar).toHaveBeenCalledWith('user-1');
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Content-Length': 3,
    });
    expect(res.end).toHaveBeenCalledWith(Buffer.from('img'));
  });

  it('DELETE /avatar delega en profileService.deleteAvatar con el id del usuario autenticado', async () => {
    const result = await controller.deleteAvatar(user);

    expect(profileService.deleteAvatar).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ avatarUpdatedAt: null });
  });
});

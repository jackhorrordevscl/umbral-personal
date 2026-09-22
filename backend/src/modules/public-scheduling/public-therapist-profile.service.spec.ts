import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PublicTherapistProfileService } from './public-therapist-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import * as avatarStorage from '../../common/utils/avatar-storage.util';

jest.mock('../../common/utils/avatar-storage.util');

const mockReadAvatarBuffer =
  avatarStorage.readAvatarBuffer as jest.MockedFunction<
    typeof avatarStorage.readAvatarBuffer
  >;
// isAvatarNotFoundError es lógica pura (no I/O) -- se usa la implementación
// real para seguir probando la traducción real de errores de B2 a 404.
const { isAvatarNotFoundError } = jest.requireActual<typeof avatarStorage>(
  '../../common/utils/avatar-storage.util',
);
(avatarStorage.isAvatarNotFoundError as jest.Mock).mockImplementation(
  isAvatarNotFoundError,
);

// Issue #155: GET /public/therapists/:id/profile y .../avatar -- sin
// JwtAuthGuard, así que nunca deben devolver email ni ningún otro campo
// sensible del User (ver spec.md "no PHI, no dato sensible").
describe('PublicTherapistProfileService', () => {
  let service: PublicTherapistProfileService;
  let prisma: { user: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn() } };
    service = new PublicTherapistProfileService(
      prisma as unknown as PrismaService,
    );
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('devuelve solo name/bio/specialty/hasAvatar -- nunca email', async () => {
      prisma.user.findFirst.mockResolvedValue({
        name: 'Dra. Ejemplo',
        bio: 'Bio corta',
        specialty: 'Ansiedad',
        avatarMimeType: 'image/png',
      });

      const result = await service.getProfile('therapist-1');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'therapist-1',
          deletedAt: null,
          role: Role.PROFESSIONAL,
        },
        select: {
          name: true,
          bio: true,
          specialty: true,
          avatarMimeType: true,
        },
      });
      expect(result).toEqual({
        name: 'Dra. Ejemplo',
        bio: 'Bio corta',
        specialty: 'Ansiedad',
        hasAvatar: true,
      });
    });

    it('hasAvatar es false cuando avatarMimeType es null', async () => {
      prisma.user.findFirst.mockResolvedValue({
        name: 'Dra. Ejemplo',
        bio: null,
        specialty: null,
        avatarMimeType: null,
      });

      const result = await service.getProfile('therapist-1');

      expect(result.hasAvatar).toBe(false);
    });

    it('lanza 404 si el terapeuta no existe, está borrado, o no es PROFESSIONAL', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getProfile('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAvatar', () => {
    it('lee el buffer del mismo AVATAR_DIR que usa el flujo privado', async () => {
      prisma.user.findFirst.mockResolvedValue({ avatarMimeType: 'image/png' });
      const buffer = Buffer.from('fake-image');
      mockReadAvatarBuffer.mockResolvedValue(buffer);

      const result = await service.getAvatar('therapist-1');

      expect(mockReadAvatarBuffer).toHaveBeenCalledWith('therapist-1');
      expect(result).toEqual({ buffer, mimeType: 'image/png' });
    });

    it('lanza 404 si el terapeuta no tiene avatar', async () => {
      prisma.user.findFirst.mockResolvedValue({ avatarMimeType: null });

      await expect(service.getAvatar('therapist-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockReadAvatarBuffer).not.toHaveBeenCalled();
    });

    it('lanza 404 si el terapeuta no existe', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getAvatar('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza 404 (no 500) si el objeto del avatar no existe en B2 (NoSuchKey)', async () => {
      prisma.user.findFirst.mockResolvedValue({ avatarMimeType: 'image/png' });
      const notFound = Object.assign(
        new Error('The specified key does not exist.'),
        { name: 'NoSuchKey' },
      );
      mockReadAvatarBuffer.mockRejectedValue(notFound);

      await expect(service.getAvatar('therapist-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propaga cualquier otro error de B2 distinto de "no encontrado"', async () => {
      prisma.user.findFirst.mockResolvedValue({ avatarMimeType: 'image/png' });
      const accessDenied = Object.assign(new Error('permission denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      mockReadAvatarBuffer.mockRejectedValue(accessDenied);

      await expect(service.getAvatar('therapist-1')).rejects.toThrow(
        'permission denied',
      );
    });
  });
});

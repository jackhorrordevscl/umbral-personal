import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PublicTherapistProfileService } from './public-therapist-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { readAvatarBuffer } from '../../common/utils/avatar-storage.util';

jest.mock('../../common/utils/avatar-storage.util', () => ({
  readAvatarBuffer: jest.fn(),
}));

const mockReadAvatarBuffer = readAvatarBuffer as jest.MockedFunction<
  typeof readAvatarBuffer
>;

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
  });
});

import { Role } from '@prisma/client';
import { PublicTherapistResolverService } from './public-therapist-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PublicTherapistResolverService', () => {
  const uuid = '35a86f8b-0a4e-4f43-9b9e-0c1d2e3f4a5b';
  let service: PublicTherapistResolverService;
  let prisma: { user: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn() } };
    service = new PublicTherapistResolverService(
      prisma as unknown as PrismaService,
    );
  });

  it('devuelve el UUID tal cual, sin consultar la base', async () => {
    await expect(service.resolveId(uuid)).resolves.toBe(uuid);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('resuelve un slug al id del terapeuta activo', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: uuid });

    await expect(service.resolveId('juan-jose-martinez')).resolves.toBe(uuid);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        slug: 'juan-jose-martinez',
        deletedAt: null,
        role: Role.PROFESSIONAL,
      },
      select: { id: true },
    });
  });

  it('devuelve null si el slug no existe', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.resolveId('no-existe')).resolves.toBeNull();
  });
});

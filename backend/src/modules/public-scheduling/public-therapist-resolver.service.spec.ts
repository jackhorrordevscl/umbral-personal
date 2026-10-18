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

  // Issue #496: el UUID recibe los mismos filtros que el slug (terapeuta
  // activo y con rol PROFESSIONAL).
  it('resuelve un UUID de un terapeuta activo con los mismos filtros que el slug', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: uuid });

    await expect(service.resolveId(uuid)).resolves.toBe(uuid);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: uuid, deletedAt: null, role: Role.PROFESSIONAL },
      select: { id: true },
    });
  });

  it('devuelve null si el UUID es de un usuario borrado o sin rol PROFESSIONAL', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.resolveId(uuid)).resolves.toBeNull();
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

import { Reflector } from '@nestjs/core';
import { PublicTherapistProfileController } from './public-therapist-profile.controller';
import { PublicTherapistProfileService } from './public-therapist-profile.service';
import { FOREIGN_THROTTLER_NAMES } from './public-scheduling.controller';

const THROTTLER_SKIP = 'THROTTLER:SKIP';

// Controller delgado, mismo criterio que PublicSchedulingController: solo
// delega en el service. Sin JwtAuthGuard a propósito (issue #155, perfil
// público de la autoagenda).
describe('PublicTherapistProfileController', () => {
  let controller: PublicTherapistProfileController;
  let service: { getProfile: jest.Mock; getAvatar: jest.Mock };

  beforeEach(() => {
    service = { getProfile: jest.fn(), getAvatar: jest.fn() };
    controller = new PublicTherapistProfileController(
      service as unknown as PublicTherapistProfileService,
    );
  });

  it('GET profile delega en el service con el :therapistId de la ruta', async () => {
    const profile = { name: 'Dra. Ejemplo', hasAvatar: false };
    service.getProfile.mockResolvedValue(profile);

    const result = await controller.getProfile('therapist-1');

    expect(result).toBe(profile);
    expect(service.getProfile).toHaveBeenCalledWith('therapist-1');
  });

  it('GET avatar delega en el service y escribe Content-Type/Content-Length/CORP en la respuesta', async () => {
    const buffer = Buffer.from('fake-image');
    service.getAvatar.mockResolvedValue({ buffer, mimeType: 'image/png' });
    const res = { set: jest.fn(), end: jest.fn() };

    await controller.getAvatar('therapist-1', res as never);

    expect(service.getAvatar).toHaveBeenCalledWith('therapist-1');
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    expect(res.end).toHaveBeenCalledWith(buffer);
  });

  // Mismo bug de fondo documentado en public-scheduling.controller.spec.ts:
  // ThrottlerModule es @Global(), así que estas rutas también deben saltear
  // todos los throttlers ajenos (incluidos los de ProfileModule).
  describe('exhaustividad de @SkipThrottle (throttlers ajenos)', () => {
    const reflector = new Reflector();

    it.each(['getProfile', 'getAvatar'] as const)(
      '%s saltea todos los throttlers ajenos y comparte "public-availability"',
      (methodName) => {
        const handler = (
          controller as unknown as Record<string, () => unknown>
        )[methodName];

        for (const name of Object.keys(FOREIGN_THROTTLER_NAMES)) {
          expect(
            reflector.get<boolean | undefined>(THROTTLER_SKIP + name, handler),
          ).toBe(true);
        }
        expect(
          reflector.get<boolean | undefined>(
            THROTTLER_SKIP + 'public-booking',
            handler,
          ),
        ).toBe(true);
        expect(
          reflector.get<boolean | undefined>(
            THROTTLER_SKIP + 'public-availability',
            handler,
          ),
        ).toBeUndefined();
      },
    );
  });
});

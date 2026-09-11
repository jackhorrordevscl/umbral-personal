import { Reflector } from '@nestjs/core';
import { EmailChangeController } from './email-change.controller';
import { EmailChangeService } from './email-change.service';

// @nestjs/throttler no exporta THROTTLER_SKIP en su API pública -- ver el
// mismo criterio en auth.controller.spec.ts.
const THROTTLER_SKIP = 'THROTTLER:SKIP';

/**
 * Issue #79 (follow-up de #76 PR A): cobertura mínima de que el controller
 * delega en EmailChangeService sin agregar lógica propia -- el guard/
 * throttler stack (ThrottlerGuard + SkipThrottle, ver email-change.controller.ts)
 * se ejerce en profile.e2e-spec.ts, no acá.
 */
describe('EmailChangeController', () => {
  let controller: EmailChangeController;
  let emailChangeService: { confirm: jest.Mock };

  beforeEach(() => {
    emailChangeService = {
      confirm: jest.fn().mockResolvedValue({
        message: 'Email actualizado correctamente.',
      }),
    };

    controller = new EmailChangeController(
      emailChangeService as unknown as EmailChangeService,
    );
  });

  it('POST /confirm delega en emailChangeService.confirm con el token del DTO', async () => {
    const result = await controller.confirm({ token: 'signed-jwt-token' });

    expect(emailChangeService.confirm).toHaveBeenCalledWith('signed-jwt-token');
    expect(result).toEqual({ message: 'Email actualizado correctamente.' });
  });

  it('POST /confirm propaga los errores lanzados por emailChangeService.confirm (token inválido/expirado, etc.)', async () => {
    emailChangeService.confirm.mockRejectedValue(
      new Error('Token de confirmación inválido o expirado'),
    );

    await expect(controller.confirm({ token: 'bad-token' })).rejects.toThrow(
      'Token de confirmación inválido o expirado',
    );
  });

  // Bug reportado en pruebas manuales de sdd/patient-self-scheduling PR 3:
  // ThrottlerModule es @Global(), así que los dos throttlers nuevos
  // ('public-availability'/'public-booking') aplican a esta ruta también --
  // el named-throttler audit de PR 3 (tasks.md 3.3) solo tocó
  // auth.controller.ts.
  describe('exhaustividad de @SkipThrottle (public-availability/public-booking)', () => {
    const reflector = new Reflector();

    it('confirm saltea public-availability y public-booking', () => {
      const handler = (controller as unknown as Record<string, () => unknown>)
        .confirm;

      expect(
        reflector.get<boolean | undefined>(
          THROTTLER_SKIP + 'public-availability',
          handler,
        ),
      ).toBe(true);
      expect(
        reflector.get<boolean | undefined>(
          THROTTLER_SKIP + 'public-booking',
          handler,
        ),
      ).toBe(true);
    });
  });
});

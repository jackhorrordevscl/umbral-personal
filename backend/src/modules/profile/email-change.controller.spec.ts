import { EmailChangeController } from './email-change.controller';
import { EmailChangeService } from './email-change.service';

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
});

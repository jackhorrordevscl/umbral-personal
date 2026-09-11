import { Reflector } from '@nestjs/core';
import { PublicSchedulingController } from './public-scheduling.controller';
import { PublicSchedulingService } from './public-scheduling.service';

// @nestjs/throttler no exporta THROTTLER_SKIP en su API pública -- ver el
// mismo criterio en auth.controller.spec.ts.
const THROTTLER_SKIP = 'THROTTLER:SKIP';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.6): controller delgado --
// solo delega en PublicSchedulingService, mismo criterio que
// AvailabilityController/PatientsController de este código base. Sin
// JwtAuthGuard a propósito: ambas rutas son públicas (spec.md "Public
// Availability Read Endpoint"/"Public Booking Write Endpoint").
describe('PublicSchedulingController', () => {
  let controller: PublicSchedulingController;
  let service: { getAvailability: jest.Mock; book: jest.Mock };

  beforeEach(() => {
    service = { getAvailability: jest.fn(), book: jest.fn() };
    controller = new PublicSchedulingController(
      service as unknown as PublicSchedulingService,
    );
  });

  it('GET availability delega en PublicSchedulingService.getAvailability con el :therapistId de la ruta', async () => {
    const slots = [{ start: 'a', end: 'b' }];
    service.getAvailability.mockResolvedValue(slots);

    const query = {
      from: '2026-09-01T00:00:00-04:00',
      to: '2026-09-05T00:00:00-04:00',
    };
    const result = await controller.getAvailability(
      'therapist-1',
      query as never,
    );

    expect(result).toBe(slots);
    expect(service.getAvailability).toHaveBeenCalledWith('therapist-1', query);
  });

  it('POST book delega en PublicSchedulingService.book con el :therapistId de la ruta', async () => {
    const consultation = { id: 'c-1' };
    service.book.mockResolvedValue(consultation);

    const dto = {
      slotStart: '2026-09-05T13:00:00.000Z',
      patient: {
        fullName: 'Paciente',
        rut: '11.111.111-1',
        birthDate: '1990-01-01',
        email: 'paciente@ejemplo.cl',
      },
    };
    const result = await controller.book('therapist-1', dto as never);

    expect(result).toBe(consultation);
    expect(service.book).toHaveBeenCalledWith('therapist-1', dto);
  });

  // Bug reportado en pruebas manuales: ThrottlerModule es @Global() en esta
  // versión de @nestjs/throttler (ver key learning de PR 3), así que TODO
  // nombre registrado en CUALQUIER módulo (no solo AuthModule) aplica a
  // estas rutas salvo que se saltee explícitamente. auth.controller.spec.ts
  // ya cubre la dirección "las rutas de auth saltean los throttlers
  // públicos nuevos"; este test cubre la dirección inversa, que faltaba: las
  // rutas públicas deben saltear TODOS los throttlers ajenos (incluidos los
  // de ProfileModule, que están en un módulo distinto de AuthModule y por
  // eso quedaron afuera del @SkipThrottle original -- ProfileModule los
  // registra en su propio buildProfileThrottlerOptions, no en auth.module.ts).
  describe('exhaustividad de @SkipThrottle (throttlers ajenos a public-scheduling)', () => {
    const reflector = new Reflector();
    const foreignThrottlerNames = [
      'login',
      'mfa-verify',
      'signup',
      'mfa-setup',
      'password-change',
      'verify-email',
      'resend-verification',
      'password-reset',
      'mfa-recover',
      'profile-update',
      'email-change-confirm',
    ] as const;

    it.each([
      ['getAvailability', 'public-booking'] as const,
      ['book', 'public-availability'] as const,
    ])(
      '%s saltea todos los throttlers ajenos (incluye ProfileModule)',
      (methodName, ownSiblingName) => {
        const handler = (
          controller as unknown as Record<string, () => unknown>
        )[methodName];

        for (const name of foreignThrottlerNames) {
          expect(
            reflector.get<boolean | undefined>(THROTTLER_SKIP + name, handler),
          ).toBe(true);
        }
        // La ruta hermana (booking para getAvailability, availability para
        // book) también debe saltearse -- cada endpoint solo consume su
        // propio cupo.
        expect(
          reflector.get<boolean | undefined>(
            THROTTLER_SKIP + ownSiblingName,
            handler,
          ),
        ).toBe(true);
      },
    );
  });
});

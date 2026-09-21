import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// @nestjs/throttler no exporta THROTTLER_SKIP en su API pública (vive en
// throttler.constants.ts, interno) -- se replica el valor literal tal cual
// aparece en dist/throttler.constants.js de la versión instalada.
const THROTTLER_SKIP = 'THROTTLER:SKIP';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.3, design.md "risk"): un
// @SkipThrottle olvidado en una ruta existente relajaría en silencio su
// límite de fuerza bruta (ahora también contra 'public-availability'/
// 'public-booking'). En vez de confiar en una revisión manual de cada
// decorador, este test recorre los métodos reales del controller vía
// Reflector -- si alguien agrega una ruta nueva con ThrottlerGuard y se
// olvida uno de los dos nombres nuevos, este test falla.
//
// Issue #133: 'payment-confirm'/'payment-return' (buildPaymentsThrottlerOptions
// en payments.module.ts) son otro módulo satélite más registrando su propio
// ThrottlerModule.forRootAsync -- mismo riesgo que public-scheduling, así que
// se cubren en la misma lista en vez de un describe separado.
describe('AuthController — exhaustividad de @SkipThrottle (public-scheduling, payments)', () => {
  const reflector = new Reflector();
  const controller = new AuthController({} as AuthService);

  const throttledMethodNames = [
    'login',
    'verifyMfa',
    'signup',
    'verifyEmail',
    'resendVerification',
    'beginMfaSetup',
    'confirmMfaSetup',
    'changePassword',
    'forgotPassword',
    'resetPassword',
    'recoverMfa',
  ] as const;

  const foreignThrottlerNames = [
    'public-availability',
    'public-booking',
    'payment-confirm',
    'payment-return',
  ] as const;

  it.each(throttledMethodNames)(
    '%s saltea explícitamente public-availability, public-booking, payment-confirm y payment-return',
    (methodName) => {
      const handler = (controller as unknown as Record<string, () => unknown>)[
        methodName
      ];
      // @nestjs/throttler no guarda un único mapa: cada nombre saltado se
      // reflect-metadata bajo su propia clave 'THROTTLER:SKIP' + name (ver
      // SkipThrottle en throttler.decorator.js) -- de ahí la lectura por
      // clave compuesta en vez de un solo reflector.get() sobre un objeto.
      for (const name of foreignThrottlerNames) {
        expect(
          reflector.get<boolean | undefined>(THROTTLER_SKIP + name, handler),
        ).toBe(true);
      }
    },
  );
});

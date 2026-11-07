import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { buildAppThrottlerOptions } from './throttler.config';
import { AuthController } from '../modules/auth/auth.controller';
import { ProfileController } from '../modules/profile/profile.controller';
import { EmailChangeController } from '../modules/profile/email-change.controller';
import { PaymentsController } from '../modules/payments/payments.controller';
import { ReportsController } from '../modules/reports/reports.controller';
import { PublicSchedulingController } from '../modules/public-scheduling/public-scheduling.controller';
import { BillingController } from '../modules/billing/billing.controller';

// @nestjs/throttler no exporta esta constante en su API pública; se replica
// el valor literal (mismo criterio que auth.controller.spec.ts).
const THROTTLER_SKIP = 'THROTTLER:SKIP';

type Ctrl = { name: string; prototype: object };

// Issue #627 (ronda A del Judgment Day): ThrottlerModule es @Global(), así que
// toda ruta guardada por un throttler consume el cupo de TODOS los throttlers
// registrados salvo los que saltea. Una ruta que olvida saltear uno ajeno
// comparte presupuesto con otro módulo (en producción, 'profile-update' deja
// 5 intentos cada 15 minutos por IP a login y mfa/verify). Esta prueba usa
// los límites reales de producción y exige que cada ruta guardada por un
// throttler tenga activo exactamente uno: el suyo.
describe('Throttlers: cada ruta guardada consume solo su propio throttler', () => {
  const production = buildAppThrottlerOptions(
    new ConfigService({ NODE_ENV: 'production' }),
  ) as { throttlers: Array<{ name: string; limit: number; ttl: number }> };
  const names = production.throttlers.map((t) => t.name);

  const controllers: Ctrl[] = [
    AuthController,
    ProfileController,
    EmailChangeController,
    PaymentsController,
    ReportsController,
    PublicSchedulingController,
    BillingController,
  ];

  const guardsOf = (target: object): string[] =>
    (
      (Reflect.getMetadata('__guards__', target) as
        | Array<{ name: string }>
        | undefined) ?? []
    ).map((guard) => guard.name);

  const guardedHandlers = controllers.flatMap((ctrl) => {
    const classGuards = guardsOf(ctrl);
    return Object.getOwnPropertyNames(ctrl.prototype)
      .filter((key) => key !== 'constructor')
      .flatMap((key) => {
        const handler = (ctrl.prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function') return [];
        const guards = [...classGuards, ...guardsOf(handler)];
        if (!guards.some((guard) => /Throttler/.test(guard))) return [];
        return [{ label: `${ctrl.name}.${key}`, ctrl, handler }];
      });
  });

  const activeThrottlers = (ctrl: Ctrl, handler: object) =>
    names.filter((name) => {
      const onMethod = Reflect.getMetadata(THROTTLER_SKIP + name, handler) as
        | boolean
        | undefined;
      const onClass = Reflect.getMetadata(THROTTLER_SKIP + name, ctrl) as
        | boolean
        | undefined;
      return !(onMethod ?? onClass);
    });

  it('registra los throttlers conocidos (un throttler nuevo obliga a revisar esta prueba)', () => {
    expect(names).toEqual([
      'login',
      'mfa-verify',
      'signup',
      'mfa-setup',
      'password-change',
      'verify-email',
      'resend-verification',
      'password-reset',
      'mfa-recover',
      'public-availability',
      'public-booking',
      'profile-update',
      'email-change-confirm',
      'payment-confirm',
      'payment-return',
      'reports-export',
    ]);
  });

  it.each(guardedHandlers.map((h) => [h.label, h] as const))(
    '%s tiene activo exactamente un throttler',
    (_label, { ctrl, handler }) => {
      expect(activeThrottlers(ctrl, handler as object)).toHaveLength(1);
    },
  );
});

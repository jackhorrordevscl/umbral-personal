import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { buildAuthThrottlerOptions } from '../modules/auth/auth.module';
import { buildPaymentsThrottlerOptions } from '../modules/payments/payments.module';
import { buildProfileThrottlerOptions } from '../modules/profile/profile.module';

type ResolvedThrottlerOptions = {
  throttlers: ThrottlerOptions[];
  getTracker: NonNullable<ThrottlerOptions['getTracker']>;
};

// Issue #363: ThrottlerModule es @Global() y forRootAsync registra UN token de
// opciones por aplicación. Con un forRootAsync en cada módulo (auth, profile,
// payments) el último en registrarse pisaba a los demás, y cada
// ThrottlerGuard terminaba sin encontrar su throttler nombrado: ninguna ruta
// limitaba. Este es el único registro; cada módulo conserva su propia
// factory con sus límites y su env var, y acá solo se concatenan.
//
// Los throttlers de profile conservan su tracker (user id, con fallback a
// IP) a nivel de throttler; el resto usa el tracker IP de AuthModule.
export function buildAppThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const auth = buildAuthThrottlerOptions(config) as ResolvedThrottlerOptions;
  const profile = buildProfileThrottlerOptions(
    config,
  ) as ResolvedThrottlerOptions;
  const payments = buildPaymentsThrottlerOptions(
    config,
  ) as ResolvedThrottlerOptions;

  return {
    throttlers: [
      ...auth.throttlers,
      ...profile.throttlers.map((throttler) => ({
        ...throttler,
        getTracker: profile.getTracker,
      })),
      ...payments.throttlers,
    ],
    getTracker: auth.getTracker,
  };
}

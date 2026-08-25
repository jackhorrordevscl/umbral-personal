import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { EmailChangeService } from './email-change.service';
import { EmailChangeController } from './email-change.controller';
import { AuthModule, getLoginTracker } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';

/**
 * Issue #76: ProfileModule necesita su propio ThrottlerModule.forRootAsync
 * (AuthModule no exporta el suyo, y su tracker es IP-based -- ver
 * auth.module.ts) con dos throttlers nombrados:
 * - 'profile-update': PATCH /profile, keyed por user id (no por IP: varios
 *   profesionales detrás de la misma IP/VPN no deben compartir presupuesto).
 * - 'email-change-confirm': POST /profile/email-change/confirm, sin
 *   JwtAuthGuard (el usuario todavía no tiene sesión en esa casilla nueva),
 *   así que cae al tracker IP-based igual que los throttlers de AuthModule.
 *
 * Un solo `getTracker` compartido resuelve ambos casos: si el request ya
 * pasó por JwtAuthGuard (clase, en ProfileController) trae `req.user.id`;
 * si no (EmailChangeController, sin guard), cae a getLoginTracker (mismo
 * criterio X-Forwarded-For/TRUSTED_PROXY_HOPS que AuthModule).
 */
const throttlerLogger = new Logger('ProfileThrottlerConfig');

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  varName: string,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throttlerLogger.warn(
    `${varName}="${raw}" no es un entero positivo válido, usando el default (${fallback}).`,
  );
  return fallback;
}

export function buildProfileThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const isTest = config.get<string>('NODE_ENV') === 'test';

  const profileUpdateLimit = parsePositiveInt(
    config.get<string>('PROFILE_UPDATE_THROTTLE_LIMIT'),
    isTest ? 1000 : 5,
    'PROFILE_UPDATE_THROTTLE_LIMIT',
  );
  const profileUpdateTtl = parsePositiveInt(
    config.get<string>('PROFILE_UPDATE_THROTTLE_TTL_MS'),
    900000,
    'PROFILE_UPDATE_THROTTLE_TTL_MS',
  );

  const emailChangeConfirmLimit = parsePositiveInt(
    config.get<string>('EMAIL_CHANGE_CONFIRM_THROTTLE_LIMIT'),
    isTest ? 1000 : 10,
    'EMAIL_CHANGE_CONFIRM_THROTTLE_LIMIT',
  );
  const emailChangeConfirmTtl = parsePositiveInt(
    config.get<string>('EMAIL_CHANGE_CONFIRM_THROTTLE_TTL_MS'),
    60000,
    'EMAIL_CHANGE_CONFIRM_THROTTLE_TTL_MS',
  );

  const trustedProxyHops = parsePositiveInt(
    config.get<string>('TRUSTED_PROXY_HOPS'),
    1,
    'TRUSTED_PROXY_HOPS',
  );

  return {
    throttlers: [
      {
        name: 'profile-update',
        limit: profileUpdateLimit,
        ttl: profileUpdateTtl,
      },
      {
        name: 'email-change-confirm',
        limit: emailChangeConfirmLimit,
        ttl: emailChangeConfirmTtl,
      },
    ],
    getTracker: (req: Record<string, any>) =>
      (req.user as { id?: string } | undefined)?.id ??
      getLoginTracker(
        req as Parameters<typeof getLoginTracker>[0],
        trustedProxyHops,
      ),
  };
}

@Module({
  imports: [
    AuthModule,
    MailModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildProfileThrottlerOptions,
    }),
  ],
  controllers: [ProfileController, EmailChangeController],
  providers: [ProfileService, EmailChangeService],
})
export class ProfileModule {}

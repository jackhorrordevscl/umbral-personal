import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ClinicalTextCryptoModule } from '../../common/crypto/clinical-text-crypto.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { PatientsModule } from '../patients/patients.module';
import { getLoginTracker } from '../auth/auth.module';

/**
 * Issue #504: la ficha PDF descifra todas las consultas y se arma en el event
 * loop, así que el endpoint lleva un tope de pedidos. El throttler
 * 'reports-export' va keyed por user id (varios terapeutas detrás de la misma
 * IP no comparten cupo), con fallback a IP si el request no trae usuario.
 *
 * ThrottlerModule es @Global() y todos los throttlers nombrados aplican a
 * cualquier ruta con ThrottlerGuard; en vez de sumar este nombre a cada
 * @SkipThrottle de la app, el throttler se salta solo fuera de
 * ReportsController. La relación inversa (ReportsController saltea los
 * throttlers ajenos) la declara el propio controller.
 */
const throttlerLogger = new Logger('ReportsThrottlerConfig');

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

export function buildReportsThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const isTest = config.get<string>('NODE_ENV') === 'test';

  const exportLimit = parsePositiveInt(
    config.get<string>('REPORTS_EXPORT_THROTTLE_LIMIT'),
    isTest ? 1000 : 5,
    'REPORTS_EXPORT_THROTTLE_LIMIT',
  );
  const exportTtl = parsePositiveInt(
    config.get<string>('REPORTS_EXPORT_THROTTLE_TTL_MS'),
    60000,
    'REPORTS_EXPORT_THROTTLE_TTL_MS',
  );

  const trustedProxyHops = parsePositiveInt(
    config.get<string>('TRUSTED_PROXY_HOPS'),
    1,
    'TRUSTED_PROXY_HOPS',
  );

  return {
    throttlers: [
      {
        name: 'reports-export',
        limit: exportLimit,
        ttl: exportTtl,
        skipIf: (context) => context.getClass() !== ReportsController,
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
  imports: [ClinicalTextCryptoModule, PatientsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}

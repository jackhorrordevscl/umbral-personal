import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerException,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash } from 'crypto';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.2, design.md Decision 7 "Rate
// limiting"): el getTracker de buildAuthThrottlerOptions (AuthModule) es
// GLOBAL a nivel de ThrottlerModule -- no puede distinguir "por terapeuta" o
// "por email" según la ruta. Por eso este guard sobreescribe getTracker en
// vez de reusar el de AuthModule, mismo criterio documentado en design.md
// ("Module-level getTracker is global, so per-therapist/per-email tracking
// needs a guard subclass").
//
// Función pura exportada aparte (mismo patrón que getLoginTracker en
// auth.module.ts) para poder testearla sin instanciar el guard completo, que
// requiere options/storageService/reflector reales de @nestjs/throttler.
//
// spec.md "Throttling does not leak email in logs": el email NUNCA viaja en
// claro en el tracker (que @nestjs/throttler usa como clave y puede terminar
// en logs de storage) -- se hashea con SHA-256 tras normalizar
// trim+lowercase, así que el mismo email con distinto casing cae en el mismo
// bucket de throttling.
export function getPublicScheduleTracker(req: {
  ip: string;
  params?: Record<string, string | string[] | undefined>;
  body?: { email?: unknown; patient?: { email?: unknown } };
}): string {
  const rawTherapistId = req.params?.['therapistId'];
  const therapistId = Array.isArray(rawTherapistId)
    ? rawTherapistId[0]
    : (rawTherapistId ?? 'unknown');

  const rawEmail = req.body?.patient?.email ?? req.body?.email;
  if (typeof rawEmail === 'string' && rawEmail.length > 0) {
    const emailHash = createHash('sha256')
      .update(rawEmail.trim().toLowerCase())
      .digest('hex');
    return `${req.ip}:${therapistId}:${emailHash}`;
  }

  return `${req.ip}:${therapistId}`;
}

// Issue #299: el bucket por email de arriba se abre de nuevo con cada email
// distinto, así que por sí solo no acota nada -- quien cambie el email en cada
// request nunca lo agota. Este límite NO depende del body: acota por
// ip:therapistId (todas las variantes de email de un mismo origen). Se aplica
// solo a POST (la reserva, que crea Patient + Consultation), y se implementa
// sobre el mismo storage del ThrottlerGuard en vez de registrar throttlers
// nombrados nuevos: ThrottlerModule es @Global() y cada nombre nuevo obligaría
// a listarlo en @SkipThrottle de todas las rutas ajenas (ver
// FOREIGN_THROTTLER_NAMES).
//
// El tope diario por terapeuta NO vive acá: cuenta solo reservas exitosas, así
// que se consulta en base de datos (PublicSchedulingService.book) en vez de
// contar hits de storage, que también sumarían los intentos fallidos.
export const PUBLIC_BOOKING_IP_BUCKET = 'public-booking-ip-therapist';

export interface PublicBookingExtraLimits {
  ipTherapistLimit: number;
  ipTherapistTtlMs: number;
}

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildPublicBookingExtraLimits(
  config: Pick<ConfigService, 'get'>,
): PublicBookingExtraLimits {
  const isTest = config.get<string>('NODE_ENV') === 'test';
  return {
    ipTherapistLimit: parsePositiveInt(
      config.get<string>('PUBLIC_BOOKING_IP_THROTTLE_LIMIT'),
      isTest ? 1000 : 10,
    ),
    ipTherapistTtlMs: parsePositiveInt(
      config.get<string>('PUBLIC_BOOKING_IP_THROTTLE_TTL_MS'),
      60 * 60 * 1000,
    ),
  };
}

@Injectable()
export class PublicScheduleThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(PublicScheduleThrottlerGuard.name);
  private readonly extraLimits: PublicBookingExtraLimits;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService,
  ) {
    super(options, storageService, reflector);
    this.extraLimits = buildPublicBookingExtraLimits(config);
  }

  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(
      getPublicScheduleTracker(
        req as Parameters<typeof getPublicScheduleTracker>[0],
      ),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = await super.canActivate(context);
    if (!allowed) return false;

    const req = context.switchToHttp().getRequest<{
      method?: string;
      ip: string;
      params?: Record<string, string | string[] | undefined>;
    }>();
    if (req.method !== 'POST') return true;

    const rawTherapistId = req.params?.['therapistId'];
    const therapistId = Array.isArray(rawTherapistId)
      ? rawTherapistId[0]
      : (rawTherapistId ?? 'unknown');
    const { ipTherapistLimit, ipTherapistTtlMs } = this.extraLimits;

    const ipRecord = await this.storageService.increment(
      `${PUBLIC_BOOKING_IP_BUCKET}:${req.ip}:${therapistId}`,
      ipTherapistTtlMs,
      ipTherapistLimit,
      ipTherapistTtlMs,
      PUBLIC_BOOKING_IP_BUCKET,
    );
    if (ipRecord.isBlocked) {
      this.logger.warn(
        `Límite por ip:therapistId excedido en la reserva pública (therapistId=${therapistId})`,
      );
      throw new ThrottlerException();
    }

    return true;
  }
}

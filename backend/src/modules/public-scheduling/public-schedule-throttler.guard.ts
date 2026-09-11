import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
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

@Injectable()
export class PublicScheduleThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(
      getPublicScheduleTracker(
        req as Parameters<typeof getPublicScheduleTracker>[0],
      ),
    );
  }
}

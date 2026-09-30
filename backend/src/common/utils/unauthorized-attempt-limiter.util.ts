// Issue #301: acota cuántas filas UNAUTHORIZED_ATTEMPT puede escribir una
// misma IP por ventana. Ventana fija en memoria (por proceso): suficiente para
// que un flood de requests sin token no haga crecer AuditLog sin tope. El Map
// tiene un tope de claves para que rotar IPs tampoco haga crecer la memoria:
// al llenarse se purgan las ventanas vencidas y, si sigue lleno, se deja de
// registrar (falla cerrado para la auditoría de ruido, no para el acceso).

export const UNAUTHORIZED_AUDIT_DEFAULT_LIMIT = 10;
export const UNAUTHORIZED_AUDIT_DEFAULT_WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 10_000;

interface Window {
  count: number;
  resetAt: number;
}

export class UnauthorizedAttemptLimiter {
  private readonly windows = new Map<string, Window>();

  allow(
    ip: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): boolean {
    const current = this.windows.get(ip);
    if (current && current.resetAt > now) {
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    }

    if (!current && this.windows.size >= MAX_TRACKED_IPS) {
      this.purgeExpired(now);
      if (this.windows.size >= MAX_TRACKED_IPS) return false;
    }

    this.windows.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  private purgeExpired(now: number): void {
    for (const [ip, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(ip);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

// Instancia compartida: JwtAuthGuard se instancia por módulo, y el tope debe
// valer para todo el proceso.
export const sharedUnauthorizedAttemptLimiter =
  new UnauthorizedAttemptLimiter();

export function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

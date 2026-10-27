export const GRACE_DAYS = 7;
export const PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessState = 'EXEMPT' | 'ACTIVE' | 'GRACE' | 'READ_ONLY';

export interface AccessInput {
  now: Date;
  currentPeriodEnd: Date | null;
  // Concesión por email: expiresAt null = permanente.
  grant: { expiresAt: Date | null } | null;
}

export interface AccessResult {
  state: AccessState;
  // Fin del período pagado (ACTIVE y GRACE) o de la concesión temporal.
  periodEnd: Date | null;
  // Fin de la gracia; solo en GRACE.
  graceEnd: Date | null;
}

// Issue #611: el estado se calcula al leer desde currentPeriodEnd; no depende
// de un cron que lo escriba, así que un cron caído no cambia el acceso.
export function resolveAccessState({
  now,
  currentPeriodEnd,
  grant,
}: AccessInput): AccessResult {
  if (grant && (grant.expiresAt === null || grant.expiresAt > now)) {
    return { state: 'EXEMPT', periodEnd: grant.expiresAt, graceEnd: null };
  }
  if (currentPeriodEnd === null) {
    return { state: 'READ_ONLY', periodEnd: null, graceEnd: null };
  }
  if (currentPeriodEnd > now) {
    return { state: 'ACTIVE', periodEnd: currentPeriodEnd, graceEnd: null };
  }
  const graceEnd = new Date(currentPeriodEnd.getTime() + GRACE_DAYS * DAY_MS);
  if (graceEnd > now) {
    return { state: 'GRACE', periodEnd: currentPeriodEnd, graceEnd };
  }
  return { state: 'READ_ONLY', periodEnd: currentPeriodEnd, graceEnd: null };
}

// max(ahora, vencimientoActual) + días: pagar antes de vencer no pierde días.
export function extendPeriod(
  now: Date,
  currentPeriodEnd: Date | null,
  days: number,
): Date {
  const base =
    currentPeriodEnd && currentPeriodEnd > now ? currentPeriodEnd : now;
  return new Date(base.getTime() + days * DAY_MS);
}

import { santiagoDayNumber } from './reminder-schedule';

// Issue #633: una suscripción vigente solo se puede renovar en los últimos 5
// días de su período. Coincide con el primer aviso de vencimiento
// (REMINDER_OFFSETS_DAYS) y se cuenta en días calendario de Santiago, igual que
// los avisos, para que el botón se habilite el mismo día en que llega el aviso.
export const RENEWAL_WINDOW_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRenewalOpen(now: Date, currentPeriodEnd: Date): boolean {
  return (
    santiagoDayNumber(currentPeriodEnd) - santiagoDayNumber(now) <=
    RENEWAL_WINDOW_DAYS
  );
}

// Instante desde el que se puede renovar; solo para mostrarlo como fecha.
export function renewalOpensAt(currentPeriodEnd: Date): Date {
  return new Date(currentPeriodEnd.getTime() - RENEWAL_WINDOW_DAYS * DAY_MS);
}

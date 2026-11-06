import { santiagoDayNumber } from './reminder-schedule';

// Issue #633: una suscripción vigente solo se puede renovar en los últimos 5
// días de su período. Coincide con el primer aviso de vencimiento
// (REMINDER_OFFSETS_DAYS) y se cuenta en días calendario de Santiago, igual que
// los avisos, para que el botón se habilite el mismo día en que llega el aviso.
export const RENEWAL_WINDOW_DAYS = 5;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function isRenewalOpen(now: Date, currentPeriodEnd: Date): boolean {
  return (
    santiagoDayNumber(currentPeriodEnd) - santiagoDayNumber(now) <=
    RENEWAL_WINDOW_DAYS
  );
}

// Primer instante en que isRenewalOpen pasa a ser verdadero: el inicio del día
// calendario de Santiago que queda 5 días antes del vencimiento. No se resta
// 5×24 h sin más: un cambio de horario entre medio corre la hora local una hora
// y la fecha podía caer un día antes o después de la que usa isRenewalOpen.
// Los desfases de Santiago son de horas enteras, así que se ajusta por horas.
export function renewalOpensAt(currentPeriodEnd: Date): Date {
  const openingDay = santiagoDayNumber(currentPeriodEnd) - RENEWAL_WINDOW_DAYS;
  // Alineado a hora exacta: así el retroceso por horas termina en el primer
  // instante del día y no en un minuto intermedio del vencimiento.
  let candidate =
    Math.floor(
      (currentPeriodEnd.getTime() - RENEWAL_WINDOW_DAYS * DAY_MS) / HOUR_MS,
    ) * HOUR_MS;
  while (santiagoDayNumber(new Date(candidate)) > openingDay) {
    candidate -= HOUR_MS;
  }
  while (santiagoDayNumber(new Date(candidate)) < openingDay) {
    candidate += HOUR_MS;
  }
  while (santiagoDayNumber(new Date(candidate - HOUR_MS)) === openingDay) {
    candidate -= HOUR_MS;
  }
  return new Date(candidate);
}

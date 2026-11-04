// Issue #611: el precio de lanzamiento se mantiene 12 meses desde que se
// congeló (priceStartedAt); pasado ese plazo se cobra el precio post-lanzamiento.
export const LAUNCH_PRICE_MONTHS = 12;
export const DEFAULT_RENEWAL_PRICE_CLP = 12990;

// Suma (o resta) meses en UTC sin desbordar al mes siguiente (29 feb -> 28 feb).
export function addUtcMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function launchPriceEnd(priceStartedAt: Date): Date {
  return addUtcMonths(priceStartedAt, LAUNCH_PRICE_MONTHS);
}

// Precio a cobrar ahora. Nunca baja del congelado: una cuenta creada con un
// precio mayor al post-lanzamiento no se abarata sola.
export function effectivePriceClp({
  priceClp,
  priceStartedAt,
  renewalPriceClp,
  now,
}: {
  priceClp: number;
  priceStartedAt: Date;
  renewalPriceClp: number;
  now: Date;
}): number {
  return now >= launchPriceEnd(priceStartedAt)
    ? Math.max(priceClp, renewalPriceClp)
    : priceClp;
}

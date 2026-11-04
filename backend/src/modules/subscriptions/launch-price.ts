// Issue #611: el precio de lanzamiento se mantiene 12 meses desde que se
// congeló (priceStartedAt); pasado ese plazo se cobra el precio post-lanzamiento.
export const LAUNCH_PRICE_MONTHS = 12;
export const DEFAULT_RENEWAL_PRICE_CLP = 12990;

// Suma meses en UTC sin desbordar al mes siguiente (29 feb -> 28 feb).
export function launchPriceEnd(priceStartedAt: Date): Date {
  const end = new Date(priceStartedAt.getTime());
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + LAUNCH_PRICE_MONTHS);
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
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

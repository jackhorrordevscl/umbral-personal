// sdd/online-payment-integration: valores fijos del módulo, centralizados
// acá para que design.md quede como única fuente de verdad de cada número
// (mismo criterio que calendar-integration.constants.ts). SWEEP_BATCH_LIMIT
// y RECONCILE_MIN_AGE_MS los consume recién PaymentsService.sweep() (PR 2);
// PR 1 solo usa PAYMENT_RETURN_PATH indirectamente vía el gateway port.

// design.md "Data Flow": tope de filas procesadas por corrida del cron
// sweep -- PR 2 (PaymentsService.sweep, pass 2 de reconciliación).
export const SWEEP_BATCH_LIMIT = 200;

// design.md "Data Flow": "token issued > 15 min ago" -- ventana mínima antes
// de reconciliar un cargo cuyo callback pudo haberse perdido -- PR 2.
export const RECONCILE_MIN_AGE_MS = 15 * 60 * 1000;

// Ruta del frontend a la que Flow redirige tras el checkout hospedado
// (returnUrl de OrderInput) -- PaymentsPage.tsx la resuelve en PR 3.
export const PAYMENT_RETURN_PATH = '/payments';

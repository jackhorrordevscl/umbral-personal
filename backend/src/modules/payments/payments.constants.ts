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

// sdd/online-payment-integration PR 2 (T5.6): ruta pública del BACKEND (no
// del frontend -- Flow hace un POST servidor-a-servidor, nunca un redirect
// de navegador) que payments.controller.ts expone sin guard. Se combina con
// BACKEND_PUBLIC_URL (payments.service.ts) para construir confirmUrl -- PR 1
// dejó esto como placeholder apuntando al frontend porque la ruta pública
// todavía no existía (ver el deviation note en apply-progress de PR 1);
// PR 2 lo corrige ahora que payments.controller.ts (T5.6) ya existe. Incluye
// el prefijo global `api/v1` (main.ts, app.setGlobalPrefix) porque Flow
// nunca pasa por el mismo pipeline de rutas que el frontend.
export const PAYMENT_CONFIRM_PATH = '/api/v1/payments/confirm';

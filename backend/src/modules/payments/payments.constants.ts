// sdd/online-payment-integration: fixed module values, centralized
// here so design.md stays the single source of truth for each number
// (same criterion as calendar-integration.constants.ts). SWEEP_BATCH_LIMIT
// and RECONCILE_MIN_AGE_MS aren't consumed until PaymentsService.sweep() (PR 2);
// PR 1 only uses PAYMENT_RETURN_PATH indirectly via the gateway port.

// design.md "Data Flow": row cap processed per sweep cron
// run -- PR 2 (PaymentsService.sweep, reconciliation pass 2).
export const SWEEP_BATCH_LIMIT = 200;

// design.md "Data Flow": "token issued > 15 min ago" -- minimum window before
// reconciling a charge whose callback may have been lost -- PR 2.
export const RECONCILE_MIN_AGE_MS = 15 * 60 * 1000;

// Frontend route Flow redirects to after the hosted checkout
// (OrderInput's returnUrl) -- PaymentsPage.tsx resolves it in PR 3.
export const PAYMENT_RETURN_PATH = '/payments';

// sdd/online-payment-integration PR 2 (T5.6): the BACKEND's public route (not
// the frontend's -- Flow makes a server-to-server POST, never a browser
// redirect) that payments.controller.ts exposes with no guard. It combines
// with BACKEND_PUBLIC_URL (payments.service.ts) to build confirmUrl -- PR 1
// left this as a placeholder pointing at the frontend because the public
// route didn't exist yet (see PR 1's apply-progress deviation note);
// PR 2 fixes it now that payments.controller.ts (T5.6) already exists. It
// includes the global `api/v1` prefix (main.ts, app.setGlobalPrefix) because
// Flow never goes through the same route pipeline as the frontend.
export const PAYMENT_CONFIRM_PATH = '/api/v1/payments/confirm';

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

// Public, unauthenticated frontend page that the PATIENT lands on after the
// hosted checkout -- App.tsx routes it OUTSIDE the authenticated layout
// (same tier as /login, /signup). NOT the destination Flow's returnUrl
// points to directly: Flow does a browser-submitted POST (confirmed against
// a real sandbox run, not documented in the public API docs), and a static
// SPA route has no server-side handler for an arbitrary POST -- see
// PAYMENT_RETURN_REDIRECT_PATH below, which is the actual returnUrl target
// and 302-redirects here as a GET once the POST lands.
export const PAYMENT_RETURN_PATH = '/pago-recibido';

// The BACKEND's public route Flow's returnUrl actually points to (bug found
// against a real sandbox: returnUrl used to be PAYMENT_RETURN_PATH directly,
// which 404'd because Vite/any static host has nothing to handle Flow's POST
// on a client-only SPA route, and that route also sits behind the
// therapist's auth layout). This one has no guard (payments.controller.ts,
// same tier as PAYMENT_CONFIRM_PATH) and does nothing but 302-redirect the
// patient's browser to PAYMENT_RETURN_PATH as a GET -- no state is read or
// mutated here, so it carries none of confirmUrl's "signal, never a source
// of truth" trust concerns.
export const PAYMENT_RETURN_REDIRECT_PATH = '/api/v1/payments/return';

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

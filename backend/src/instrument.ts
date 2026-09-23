import * as Sentry from '@sentry/node';

// Issue #191: error tracking. Must be imported before any other module in
// main.ts so the SDK can instrument them. Without SENTRY_DSN (local dev, CI,
// tests) Sentry stays disabled and this file is a no-op.
//
// This app stores clinical data, so nothing that could contain patient
// information is sent: the SDK collects no PII by default, and request bodies, cookies and
// headers are stripped before an event leaves the process.
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  return event;
}

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
}

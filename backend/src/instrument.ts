import * as Sentry from '@sentry/node';

// Issue #191: error tracking. Must be imported before any other module in
// main.ts so the SDK can instrument them. Without SENTRY_DSN (local dev, CI,
// tests) Sentry stays disabled and this file is a no-op.
//
// This app stores clinical data, so nothing that could contain patient
// information is sent: the SDK collects no PII by default, and request bodies, cookies and
// headers are stripped before an event leaves the process.
//
// Issue #283: exception messages and breadcrumbs can also carry patient data
// (a Prisma error echoes the offending values), so emails and RUTs are
// redacted from them and breadcrumb payloads are dropped.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RUT_PATTERN = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;

export function redactText(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(RUT_PATTERN, '[redacted-rut]');
}

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  if (event.message) {
    event.message = redactText(event.message);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value);
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = redactText(breadcrumb.message);
    delete breadcrumb.data;
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

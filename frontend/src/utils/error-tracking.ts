import * as Sentry from '@sentry/react'

// Issue #191: error tracking. Without VITE_SENTRY_DSN (local dev, CI, tests)
// Sentry stays disabled. This app handles clinical data: the SDK collects no PII
// by default, and request payloads/cookies are stripped before an event is sent.
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data
    delete event.request.cookies
    delete event.request.headers
  }
  return event
}

export function initErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  })
}

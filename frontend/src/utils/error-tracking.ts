import * as Sentry from '@sentry/react'

// Issue #191: error tracking. Without VITE_SENTRY_DSN (local dev, CI, tests)
// Sentry stays disabled. This app handles clinical data: the SDK collects no PII
// by default, and request payloads/cookies and URL query strings are stripped before an event is sent.
// URLs carry secrets in the query string (?token= on reset-password,
// verify-email, confirm-email-change, payment return) and search terms (a
// patient name or RUT). Only the path is kept.
function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, '')
}

const BREADCRUMB_URL_KEYS = ['url', 'from', 'to'] as const

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data
    delete event.request.cookies
    delete event.request.headers
    delete event.request.query_string
    if (event.request.url) event.request.url = stripQuery(event.request.url)
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    const data = breadcrumb.data
    if (!data) continue
    for (const key of BREADCRUMB_URL_KEYS) {
      if (typeof data[key] === 'string') data[key] = stripQuery(data[key])
    }
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

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/react'
import { initErrorTracking, scrubEvent } from './error-tracking'

vi.mock('@sentry/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/react')>()
  return { ...actual, init: vi.fn() }
})

describe('initErrorTracking', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('does not initialise Sentry without VITE_SENTRY_DSN', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')

    initErrorTracking()

    expect(Sentry.init).not.toHaveBeenCalled()
  })

  it('initialises Sentry when the DSN is set', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/1')

    initErrorTracking()

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o0.ingest.sentry.io/1',
      }),
    )
  })
})

describe('scrubEvent', () => {
  it('strips body, cookies and headers from the request', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://app.example.com/patients',
        data: { name: 'Jane' },
        cookies: { a: 'b' },
        headers: { authorization: 'Bearer x' },
      },
    } as Sentry.ErrorEvent

    expect(scrubEvent(event).request).toEqual({
      url: 'https://app.example.com/patients',
    })
  })

  it('drops the query string and hash from the request URL (tokens, search terms)', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://app.example.com/reset-password?token=abc.def#x',
        query_string: 'token=abc.def',
      },
    } as Sentry.ErrorEvent

    expect(scrubEvent(event).request).toEqual({
      url: 'https://app.example.com/reset-password',
    })
  })

  it('drops the query string from request breadcrumbs and navigation breadcrumbs', () => {
    const event = {
      type: undefined,
      breadcrumbs: [
        {
          category: 'xhr',
          data: { method: 'GET', url: '/patients?search=12.345.678-5', status_code: 200 },
        },
        {
          category: 'fetch',
          data: { url: 'https://api.example.com/patients?search=Jane+Doe' },
        },
        {
          category: 'navigation',
          data: { from: '/confirm-email-change?token=abc', to: '/login' },
        },
        { category: 'ui.click', message: 'button#save' },
      ],
    } as Sentry.ErrorEvent

    expect(scrubEvent(event).breadcrumbs).toEqual([
      {
        category: 'xhr',
        data: { method: 'GET', url: '/patients', status_code: 200 },
      },
      {
        category: 'fetch',
        data: { url: 'https://api.example.com/patients' },
      },
      {
        category: 'navigation',
        data: { from: '/confirm-email-change', to: '/login' },
      },
      { category: 'ui.click', message: 'button#save' },
    ])
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import api, {
  PUBLIC_AUTH_PATHS,
  SESSION_AUTH_PATHS,
  setUnauthorizedHandler,
} from './client'

const originalAdapter = api.defaults.adapter
const originalLocation = window.location

function failWith(status: number) {
  api.defaults.adapter = (config: InternalAxiosRequestConfig) =>
    Promise.reject(
      new AxiosError('failed', undefined, config, undefined, {
        status,
        statusText: '',
        data: {},
        headers: {},
        config,
      }),
    )
}

describe('api client', () => {
  beforeEach(() => {
    localStorage.setItem('user', '{"id":"u1"}')
    Object.defineProperty(window, 'location', {
      value: { href: '/dashboard' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
    localStorage.clear()
  })

  it('sends the session cookie (withCredentials) and no Authorization header (issue #387)', async () => {
    let seen: { withCredentials?: boolean; authorization: unknown } | undefined
    api.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      seen = {
        withCredentials: config.withCredentials,
        authorization: config.headers.Authorization,
      }
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      })
    }

    await api.get('/patients')

    expect(seen).toEqual({ withCredentials: true, authorization: undefined })
  })

  it('clears the session and redirects to /login on a 401 from a regular call', async () => {
    failWith(401)

    await expect(api.get('/patients')).rejects.toBeInstanceOf(AxiosError)

    expect(localStorage.getItem('user')).toBeNull()
    expect(window.location.href).toBe('/login')
  })

  it('calls the registered handler instead of reloading the page on a 401', async () => {
    failWith(401)
    let calls = 0
    const cleanup = setUnauthorizedHandler(() => {
      calls += 1
    })

    await expect(api.get('/patients')).rejects.toBeInstanceOf(AxiosError)
    cleanup()

    expect(calls).toBe(1)
    expect(localStorage.getItem('user')).toBeNull()
    expect(window.location.href).toBe('/dashboard')
  })

  // Derivada de la lista real para que un endpoint público nuevo quede cubierto.
  it.each([...PUBLIC_AUTH_PATHS, '/auth/login?next=1'])('does not close the session on a 401 from the public endpoint %s', async (url) => {
    failWith(401)

    await expect(api.post(url, {})).rejects.toBeInstanceOf(AxiosError)

    expect(localStorage.getItem('user')).toBe('{"id":"u1"}')
    expect(window.location.href).toBe('/dashboard')
  })

  it('treats an absolute URL to a public auth endpoint as public (issue #351)', async () => {
    failWith(401)
    const base = api.defaults.baseURL as string

    await expect(api.post(`${base}/auth/login`, {})).rejects.toBeInstanceOf(
      AxiosError,
    )

    expect(localStorage.getItem('user')).toBe('{"id":"u1"}')
  })

  it('warns in development on a 401 from an /auth/ URL that is in neither list (issue #351)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    failWith(401)

    await expect(api.post('/auth/nuevo-endpoint', {})).rejects.toBeInstanceOf(
      AxiosError,
    )

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/auth/nuevo-endpoint'))
    warn.mockRestore()
  })

  it.each([...PUBLIC_AUTH_PATHS, ...SESSION_AUTH_PATHS])(
    'does not warn on a 401 from the known endpoint %s (issue #351)',
    async (url) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      failWith(401)

      await expect(api.post(url, {})).rejects.toBeInstanceOf(AxiosError)

      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    },
  )

  it.each([
    ['post', '/auth/mfa/generate'],
    ['post', '/auth/mfa/enable'],
    ['post', '/auth/mfa/disable'],
    ['post', '/auth/logout-all'],
    ['post', '/auth/invitations'],
  ] as const)('closes the session on a 401 from the authenticated endpoint %s %s', async (method, url) => {
    failWith(401)

    await expect(api[method](url, {})).rejects.toBeInstanceOf(AxiosError)

    expect(localStorage.getItem('user')).toBeNull()
    expect(window.location.href).toBe('/login')
  })

  it('does not clear the session on non-401 errors', async () => {
    failWith(500)

    await expect(api.get('/patients')).rejects.toBeInstanceOf(AxiosError)

    expect(localStorage.getItem('user')).toBe('{"id":"u1"}')
    expect(window.location.href).toBe('/dashboard')
  })

  describe('error body of a blob request', () => {
    function failBlobWith(status: number, body: Blob) {
      api.defaults.adapter = (config: InternalAxiosRequestConfig) =>
        Promise.reject(
          new AxiosError('failed', undefined, config, undefined, {
            status,
            statusText: '',
            data: body,
            headers: {},
            config,
          }),
        )
    }

    it('parses a JSON error body so the message is readable', async () => {
      const message = 'La ficha supera el máximo de 500 sesiones por exportación'
      failBlobWith(
        422,
        new Blob([JSON.stringify({ statusCode: 422, message })], {
          type: 'application/json; charset=utf-8',
        }),
      )

      const error = await api
        .get('/reports/patient/p1', { responseType: 'blob' })
        .catch((e: AxiosError) => e)

      expect((error as AxiosError).response?.data).toEqual({
        statusCode: 422,
        message,
      })
    })

    it('leaves a non-JSON error body untouched', async () => {
      const body = new Blob(['<html>bad gateway</html>'], { type: 'text/html' })
      failBlobWith(502, body)

      const error = await api
        .get('/reports/patient/p1', { responseType: 'blob' })
        .catch((e: AxiosError) => e)

      expect((error as AxiosError).response?.data).toBe(body)
    })

    it('leaves a malformed JSON error body untouched', async () => {
      const body = new Blob(['{"message":'], { type: 'application/json' })
      failBlobWith(500, body)

      const error = await api
        .get('/reports/patient/p1', { responseType: 'blob' })
        .catch((e: AxiosError) => e)

      expect((error as AxiosError).response?.data).toBe(body)
    })
  })
})

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
    localStorage.setItem('token', 'stored-token')
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

  it('attaches the stored token as a Bearer header', async () => {
    let authorization: unknown
    api.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      authorization = config.headers.Authorization
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      })
    }

    await api.get('/patients')

    expect(authorization).toBe('Bearer stored-token')
  })

  it('clears the session and redirects to /login on a 401 from a regular call', async () => {
    failWith(401)

    await expect(api.get('/patients')).rejects.toBeInstanceOf(AxiosError)

    expect(localStorage.getItem('token')).toBeNull()
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
    expect(localStorage.getItem('token')).toBeNull()
    expect(window.location.href).toBe('/dashboard')
  })

  // Derivada de la lista real para que un endpoint público nuevo quede cubierto.
  it.each([...PUBLIC_AUTH_PATHS, '/auth/login?next=1'])('does not close the session on a 401 from the public endpoint %s', async (url) => {
    failWith(401)

    await expect(api.post(url, {})).rejects.toBeInstanceOf(AxiosError)

    expect(localStorage.getItem('token')).toBe('stored-token')
    expect(window.location.href).toBe('/dashboard')
  })

  it('treats an absolute URL to a public auth endpoint as public (issue #351)', async () => {
    failWith(401)
    const base = api.defaults.baseURL as string

    await expect(api.post(`${base}/auth/login`, {})).rejects.toBeInstanceOf(
      AxiosError,
    )

    expect(localStorage.getItem('token')).toBe('stored-token')
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

    expect(localStorage.getItem('token')).toBeNull()
    expect(window.location.href).toBe('/login')
  })

  it('does not clear the session on non-401 errors', async () => {
    failWith(500)

    await expect(api.get('/patients')).rejects.toBeInstanceOf(AxiosError)

    expect(localStorage.getItem('token')).toBe('stored-token')
    expect(window.location.href).toBe('/dashboard')
  })
})

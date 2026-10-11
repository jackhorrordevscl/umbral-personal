import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, STORAGE_SYNC_DELAY_MS } from './AuthContext'
import { useAuth, type User } from './useAuth'
import api from '../api/client'
import { ACTIVITY_STORAGE_KEY } from '../hooks/useIdleTimeout'

vi.mock('../api/client', () => ({ default: { post: vi.fn() } }))

const user: User = {
  id: 'u1',
  email: 'therapist@example.com',
  role: 'THERAPIST',
  name: 'Ana',
}

let queryClient: QueryClient

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
)

describe('AuthProvider / useAuth', () => {
  beforeEach(() => {
    queryClient = new QueryClient()
    localStorage.clear()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.post).mockResolvedValue({})
  })

  it('starts unauthenticated when storage is empty', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('restores the session from localStorage on first render', () => {
    localStorage.setItem('token', 'stored-token')
    localStorage.setItem('user', JSON.stringify(user))

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.user).toEqual(user)
    expect(result.current.token).toBe('stored-token')
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('ignores a stored token when the stored user is missing', () => {
    localStorage.setItem('token', 'stored-token')

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('treats corrupt stored user JSON as unauthenticated and clears storage', () => {
    localStorage.setItem('token', 'stored-token')
    localStorage.setItem('user', '{not-json')

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('login stores the credentials and updates the context', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => result.current.login('new-token', user))

    expect(result.current.user).toEqual(user)
    expect(result.current.token).toBe('new-token')
    expect(result.current.isAuthenticated).toBe(true)
    expect(localStorage.getItem('token')).toBe('new-token')
    expect(JSON.parse(localStorage.getItem('user') as string)).toEqual(user)
  })

  it('logout clears the context and storage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login('new-token', user))

    act(() => result.current.logout())

    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('logout revokes the session on the server with the current token', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login('new-token', user))

    act(() => result.current.logout())

    expect(api.post).toHaveBeenCalledWith('/auth/logout', null, {
      headers: { Authorization: 'Bearer new-token' },
    })
  })

  it('logout still clears local state when the API call fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login('new-token', user))

    act(() => result.current.logout())
    await Promise.resolve()

    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('logout empties the query cache so the next user cannot see the previous data (issue #291)', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login('new-token', user))
    queryClient.setQueryData(['patients'], [{ id: 'p1' }])
    queryClient.setQueryData(['profile'], { id: 'u1' })

    act(() => result.current.logout())

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(queryClient.getQueryData(['patients'])).toBeUndefined()
  })

  it('login empties the query cache left over from a previous session (issue #291)', () => {
    queryClient.setQueryData(['patients'], [{ id: 'p-previous-user' }])
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => result.current.login('new-token', user))

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('logout does not call the API when there is no session', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => result.current.logout())

    expect(api.post).not.toHaveBeenCalled()
  })

  describe('multi-tab sync via the storage event (issue #293)', () => {
    const otherUser: User = { ...user, id: 'u2', email: 'other@example.com' }

    // Simula lo que hace otra pestaña: cambia localStorage y el navegador
    // dispara `storage` solo en las demás.
    function changeFromOtherTab(token: string | null, nextUser: User | null) {
      if (token) localStorage.setItem('token', token)
      else localStorage.removeItem('token')
      if (nextUser) localStorage.setItem('user', JSON.stringify(nextUser))
      else localStorage.removeItem('user')
      dispatchStorage('token')
      settle()
    }

    function dispatchStorage(key: string) {
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key }))
      })
    }

    // La reconciliación se difiere (STORAGE_SYNC_DELAY_MS), así que los tests
    // avanzan el reloj para que se aplique.
    function settle() {
      act(() => {
        vi.advanceTimersByTime(STORAGE_SYNC_DELAY_MS)
      })
    }

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('does not expose a mixed state between the two storage events of one account switch', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login('token-a', user))
      queryClient.setQueryData(['patients'], [{ id: 'p-of-a' }])

      // La otra pestaña escribe `token` y luego `user`: dos eventos distintos.
      localStorage.setItem('token', 'token-b')
      dispatchStorage('token')
      // Entre ambos eventos no debe haber token nuevo con usuario anterior.
      expect(result.current.token).toBe('token-a')
      expect(result.current.user).toEqual(user)

      localStorage.setItem('user', JSON.stringify(otherUser))
      dispatchStorage('user')
      settle()

      expect(result.current.token).toBe('token-b')
      expect(result.current.user).toEqual(otherUser)
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    it('reconciles once when both events arrive close together', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login('token-a', user))

      localStorage.setItem('token', 'token-b')
      dispatchStorage('token')
      localStorage.setItem('user', JSON.stringify(otherUser))
      dispatchStorage('user')
      // El timer del primer evento se reinicia con el segundo.
      act(() => {
        vi.advanceTimersByTime(STORAGE_SYNC_DELAY_MS - 1)
      })
      expect(result.current.token).toBe('token-a')
      settle()
      expect(result.current.token).toBe('token-b')
    })

    it('adopts the account another tab logged into and clears the cache', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login('token-a', user))
      queryClient.setQueryData(['patients'], [{ id: 'p-of-a' }])

      changeFromOtherTab('token-b', otherUser)

      expect(result.current.user).toEqual(otherUser)
      expect(result.current.token).toBe('token-b')
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    it('logs out when another tab logs out, without calling the API again', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login('token-a', user))
      queryClient.setQueryData(['patients'], [{ id: 'p1' }])

      changeFromOtherTab(null, null)

      expect(result.current.isAuthenticated).toBe(false)
      expect(result.current.user).toBeNull()
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(api.post).not.toHaveBeenCalled()
    })

    it('logs in when another tab logs in while this one has no session', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })

      changeFromOtherTab('token-b', otherUser)

      expect(result.current.isAuthenticated).toBe(true)
      expect(result.current.user).toEqual(otherUser)
    })

    it('keeps the cache when the same account only refreshed its token', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login('token-a', user))
      queryClient.setQueryData(['patients'], [{ id: 'p1' }])

      changeFromOtherTab('token-a2', user)

      expect(result.current.token).toBe('token-a2')
      expect(queryClient.getQueryData(['patients'])).toEqual([{ id: 'p1' }])
    })

    it('ignores storage events for unrelated keys', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login('token-a', user))
      localStorage.removeItem('token')

      dispatchStorage('other')
      settle()

      expect(result.current.isAuthenticated).toBe(true)
    })
  })

  describe('expiración del JWT y marca de actividad (issue #367)', () => {
    const b64url = (o: object) =>
      btoa(JSON.stringify(o))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    const jwt = (payload: object) =>
      `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`
    const nowSec = () => Math.floor(Date.now() / 1000)

    it('descarta al arrancar un token con exp vencido y limpia el storage', () => {
      localStorage.setItem('token', jwt({ exp: nowSec() - 60 }))
      localStorage.setItem('user', JSON.stringify(user))

      const { result } = renderHook(() => useAuth(), { wrapper })

      expect(result.current.isAuthenticated).toBe(false)
      expect(localStorage.getItem('token')).toBeNull()
      expect(localStorage.getItem('user')).toBeNull()
    })

    it('conserva un token con exp futuro', () => {
      const token = jwt({ exp: nowSec() + 3600 })
      localStorage.setItem('token', token)
      localStorage.setItem('user', JSON.stringify(user))

      const { result } = renderHook(() => useAuth(), { wrapper })

      expect(result.current.token).toBe(token)
    })

    it.each([jwt({ sub: 'u1' }), 'a.%%%.c'])(
      'conserva un token sin exp legible (%s)',
      (token) => {
        localStorage.setItem('token', token)
        localStorage.setItem('user', JSON.stringify(user))

        const { result } = renderHook(() => useAuth(), { wrapper })

        expect(result.current.isAuthenticated).toBe(true)
      },
    )

    it('login fija la marca de actividad en ahora y logout la borra', () => {
      localStorage.setItem(ACTIVITY_STORAGE_KEY, '1')
      const { result } = renderHook(() => useAuth(), { wrapper })

      act(() => result.current.login('new-token', user))
      const stored = Number(localStorage.getItem(ACTIVITY_STORAGE_KEY))
      expect(Math.abs(stored - Date.now())).toBeLessThan(5000)

      act(() => result.current.logout())
      expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBeNull()
    })
  })

  it('throws when used outside an AuthProvider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth debe usarse dentro de AuthProvider',
    )

    errorSpy.mockRestore()
  })
})

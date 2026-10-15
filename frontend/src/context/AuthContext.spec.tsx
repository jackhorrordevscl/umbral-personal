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

// Issue #387: la sesión real es una cookie HttpOnly que el frontend no puede
// leer; en localStorage solo queda `user` como marcador de sesión.
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
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('restores the session marker from localStorage on first render', () => {
    localStorage.setItem('user', JSON.stringify(user))

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.user).toEqual(user)
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('treats corrupt stored user JSON as unauthenticated and clears storage', () => {
    localStorage.setItem('user', '{not-json')

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('discards a legacy token left in localStorage by a previous version', () => {
    localStorage.setItem('token', 'legacy-token')
    localStorage.setItem('user', JSON.stringify(user))

    renderHook(() => useAuth(), { wrapper })

    expect(localStorage.getItem('token')).toBeNull()
  })

  it('login stores only the user, never a token, and updates the context', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => result.current.login(user))

    expect(result.current.user).toEqual(user)
    expect(result.current.isAuthenticated).toBe(true)
    expect(localStorage.getItem('token')).toBeNull()
    expect(JSON.parse(localStorage.getItem('user') as string)).toEqual(user)
  })

  it('logout clears the context and storage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login(user))

    act(() => result.current.logout())

    expect(result.current.user).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('logout revokes the session on the server (the cookie travels by itself)', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login(user))

    act(() => result.current.logout())

    expect(api.post).toHaveBeenCalledWith('/auth/logout')
  })

  it('logout still clears local state when the API call fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login(user))

    act(() => result.current.logout())
    await Promise.resolve()

    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('logout empties the query cache so the next user cannot see the previous data (issue #291)', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => result.current.login(user))
    queryClient.setQueryData(['patients'], [{ id: 'p1' }])
    queryClient.setQueryData(['profile'], { id: 'u1' })

    act(() => result.current.logout())

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(queryClient.getQueryData(['patients'])).toBeUndefined()
  })

  it('login empties the query cache left over from a previous session (issue #291)', () => {
    queryClient.setQueryData(['patients'], [{ id: 'p-previous-user' }])
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => result.current.login(user))

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
    function changeFromOtherTab(nextUser: User | null) {
      if (nextUser) localStorage.setItem('user', JSON.stringify(nextUser))
      else localStorage.removeItem('user')
      dispatchStorage('user')
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

    it('adopts the account another tab logged into and clears the cache', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login(user))
      queryClient.setQueryData(['patients'], [{ id: 'p-of-a' }])

      changeFromOtherTab(otherUser)

      expect(result.current.user).toEqual(otherUser)
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    it('reconciles once when several events arrive close together', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login(user))

      localStorage.setItem('user', JSON.stringify(otherUser))
      dispatchStorage('user')
      dispatchStorage('user')
      // El timer del primer evento se reinicia con el segundo.
      act(() => {
        vi.advanceTimersByTime(STORAGE_SYNC_DELAY_MS - 1)
      })
      expect(result.current.user).toEqual(user)
      settle()
      expect(result.current.user).toEqual(otherUser)
    })

    it('logs out when another tab logs out, without calling the API again', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login(user))
      queryClient.setQueryData(['patients'], [{ id: 'p1' }])

      changeFromOtherTab(null)

      expect(result.current.isAuthenticated).toBe(false)
      expect(result.current.user).toBeNull()
      expect(result.current.canRestoreRoute).toBe(false)
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(api.post).not.toHaveBeenCalled()
    })

    it('logs in when another tab logs in while this one has no session', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })

      changeFromOtherTab(otherUser)

      expect(result.current.isAuthenticated).toBe(true)
      expect(result.current.user).toEqual(otherUser)
    })

    it('keeps the cache when the same account is rewritten', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login(user))
      queryClient.setQueryData(['patients'], [{ id: 'p1' }])

      changeFromOtherTab(user)

      expect(queryClient.getQueryData(['patients'])).toEqual([{ id: 'p1' }])
    })

    it('ignores storage events for unrelated keys', () => {
      const { result } = renderHook(() => useAuth(), { wrapper })
      act(() => result.current.login(user))
      localStorage.removeItem('user')

      dispatchStorage('other')
      settle()

      expect(result.current.isAuthenticated).toBe(true)
    })
  })

  it('login sets the activity mark to now and logout clears it (issue #367)', () => {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, '1')
    const { result } = renderHook(() => useAuth(), { wrapper })

    act(() => result.current.login(user))
    const stored = Number(localStorage.getItem(ACTIVITY_STORAGE_KEY))
    expect(Math.abs(stored - Date.now())).toBeLessThan(5000)

    act(() => result.current.logout())
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBeNull()
  })

  it('throws when used outside an AuthProvider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth debe usarse dentro de AuthProvider',
    )

    errorSpy.mockRestore()
  })
})

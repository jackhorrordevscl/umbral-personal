import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './AuthContext'
import { useAuth, type User } from './useAuth'
import api from '../api/client'

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
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'token' }))
      })
    }

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

      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'other' }))
      })

      expect(result.current.isAuthenticated).toBe(true)
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

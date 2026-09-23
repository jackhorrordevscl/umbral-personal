import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider } from './AuthContext'
import { useAuth, type User } from './useAuth'

const user: User = {
  id: 'u1',
  email: 'therapist@example.com',
  role: 'THERAPIST',
  name: 'Ana',
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
)

describe('AuthProvider / useAuth', () => {
  beforeEach(() => {
    localStorage.clear()
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

  it('throws when used outside an AuthProvider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth debe usarse dentro de AuthProvider',
    )

    errorSpy.mockRestore()
  })
})

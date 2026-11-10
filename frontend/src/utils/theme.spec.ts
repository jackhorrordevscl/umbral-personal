import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTheme,
  setTheme,
  subscribeTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
} from './theme'

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    document.head.innerHTML = '<meta name="theme-color" content="#faf8f0">'
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('es claro por defecto', () => {
    expect(getTheme()).toBe('light')
  })

  it('setTheme("dark") pone la clase, guarda la elección y cambia theme-color', () => {
    setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    ).toBe('#0b1120')
    expect(getTheme()).toBe('dark')
  })

  it('toggleTheme alterna y vuelve a claro', () => {
    expect(toggleTheme()).toBe('dark')
    expect(toggleTheme()).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('avisa a los suscriptores y deja de avisar al desuscribirse', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTheme(listener)
    setTheme('dark')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setTheme('light')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('si localStorage está bloqueado, el tema igual cambia en esta visita', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => setTheme('dark')).not.toThrow()
    expect(getTheme()).toBe('dark')
  })
})

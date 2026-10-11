import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import Layout from './Layout'

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({ user: { email: 'a@b.cl' }, logout: vi.fn() }),
}))
vi.mock('./notifications/NotificationBell', () => ({ default: () => null }))

type Listener = (e: MediaQueryListEvent) => void

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>()
  const mq = {
    matches,
    addEventListener: vi.fn((_: string, l: Listener) => listeners.add(l)),
    removeEventListener: vi.fn((_: string, l: Listener) => listeners.delete(l)),
  }
  window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia
  return {
    mq,
    emit: (next: boolean) =>
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent)),
  }
}

function renderLayout() {
  return render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>,
  )
}

const getAside = () => document.querySelector('aside') as HTMLElement

describe('Layout (#298, #356)', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  it('en móvil el menú cerrado queda inert y aria-hidden; al abrirlo se habilita', async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    renderLayout()
    expect(getAside()).toHaveAttribute('inert')
    expect(getAside()).toHaveAttribute('aria-hidden', 'true')

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
    expect(getAside()).not.toHaveAttribute('inert')
    expect(getAside()).not.toHaveAttribute('aria-hidden')
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('en escritorio el aside nunca queda inert', () => {
    mockMatchMedia(true)
    renderLayout()
    expect(getAside()).not.toHaveAttribute('inert')
    expect(getAside()).not.toHaveAttribute('aria-hidden')
  })

  it('reacciona a cambios de matchMedia y limpia el listener al desmontar', () => {
    const { mq, emit } = mockMatchMedia(true)
    const { unmount } = renderLayout()
    expect(getAside()).not.toHaveAttribute('inert')

    act(() => emit(false))
    expect(getAside()).toHaveAttribute('inert')
    act(() => emit(true))
    expect(getAside()).not.toHaveAttribute('inert')

    unmount()
    expect(mq.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('al cerrar con "Cerrar menú" el foco vuelve a "Abrir menú"', async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    renderLayout()
    const opener = screen.getByRole('button', { name: 'Abrir menú' })
    await user.click(opener)
    screen.getByRole('button', { name: 'Cerrar menú' }).focus()

    await user.click(screen.getByRole('button', { name: 'Cerrar menú' }))

    expect(getAside()).toHaveAttribute('inert')
    expect(opener).toHaveFocus()
  })

  it('ofrece "Saltar al contenido" como primer elemento enfocable y apunta al main', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    renderLayout()

    await user.tab()

    const skip = screen.getByRole('link', { name: 'Saltar al contenido' })
    expect(skip).toHaveAttribute('href', '#main-content')
    expect(skip).toHaveFocus()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })
})

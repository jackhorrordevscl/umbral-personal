import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import IdleWarningModal from './IdleWarningModal'

function renderModal() {
  const onExtend = vi.fn()
  const onLogout = vi.fn()
  render(<IdleWarningModal onExtend={onExtend} onLogout={onLogout} />)
  return { onExtend, onLogout }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('IdleWarningModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arranca en 2:00 y descuenta con el tiempo real', () => {
    renderModal()
    expect(screen.getByRole('timer')).toHaveTextContent('2:00')

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(screen.getByRole('timer')).toHaveTextContent('1:30')
  })

  it('cierra la sesión al llegar el deadline', () => {
    const { onLogout } = renderModal()

    act(() => {
      vi.advanceTimersByTime(119_000)
    })
    expect(onLogout).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('recalcula desde el reloj al volver a ser visible tras un equipo suspendido', () => {
    const { onLogout } = renderModal()

    // Reloj salta 3 min sin que el interval corra (suspensión / pestaña oculta).
    vi.setSystemTime(new Date('2026-01-01T10:03:00Z'))
    act(() => setVisibility('visible'))

    expect(onLogout).toHaveBeenCalled()
    expect(screen.getByRole('timer')).toHaveTextContent('0:00')
  })

  it('un salto parcial del reloj se refleja de inmediato al volver a la pestaña', () => {
    const { onLogout } = renderModal()

    vi.setSystemTime(new Date('2026-01-01T10:01:30Z'))
    act(() => setVisibility('visible'))

    expect(screen.getByRole('timer')).toHaveTextContent('0:30')
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('no recalcula mientras la pestaña está oculta', () => {
    renderModal()

    vi.setSystemTime(new Date('2026-01-01T10:01:30Z'))
    act(() => setVisibility('hidden'))

    expect(screen.getByRole('timer')).toHaveTextContent('2:00')
  })

  it('los botones llaman a sus callbacks', () => {
    const { onExtend, onLogout } = renderModal()

    act(() => screen.getByText('Continuar sesión').click())
    act(() => screen.getByText('Cerrar sesión').click())

    expect(onExtend).toHaveBeenCalledTimes(1)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})

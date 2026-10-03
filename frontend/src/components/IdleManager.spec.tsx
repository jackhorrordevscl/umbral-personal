import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import IdleManager from './IdleManager'

const auth = { isAuthenticated: true, logout: vi.fn() }
vi.mock('../context/useAuth', () => ({ useAuth: () => auth }))

let warn: () => void = () => {}
let remoteActivity: () => void = () => {}
vi.mock('../hooks/useIdleTimeout', () => ({
  useIdleTimeout: ({
    onWarn,
    onRemoteActivity,
  }: {
    onWarn: () => void
    onRemoteActivity: () => void
  }) => {
    warn = onWarn
    remoteActivity = onRemoteActivity
    return { extend: vi.fn() }
  },
}))

function renderManager() {
  return render(
    <MemoryRouter>
      <IdleManager />
    </MemoryRouter>,
  )
}

describe('IdleManager', () => {
  beforeEach(() => {
    auth.isAuthenticated = true
  })

  it('muestra el aviso de expiración al vencer la inactividad con sesión activa', () => {
    renderManager()

    act(() => warn())

    expect(screen.getByText('Sesión por expirar')).toBeInTheDocument()
  })

  it('descarta el aviso si otra pestaña registra actividad', () => {
    renderManager()
    act(() => warn())
    expect(screen.getByText('Sesión por expirar')).toBeInTheDocument()

    act(() => remoteActivity())

    expect(screen.queryByText('Sesión por expirar')).not.toBeInTheDocument()
  })

  it('no muestra el aviso si no hay sesión', () => {
    auth.isAuthenticated = false
    renderManager()

    act(() => warn())

    expect(screen.queryByText('Sesión por expirar')).not.toBeInTheDocument()
  })

  it('descarta el aviso abierto si la sesión se cierra por otra vía y no reaparece al volver a iniciar sesión', () => {
    const { rerender } = renderManager()
    act(() => warn())
    expect(screen.getByText('Sesión por expirar')).toBeInTheDocument()

    auth.isAuthenticated = false
    rerender(
      <MemoryRouter>
        <IdleManager />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Sesión por expirar')).not.toBeInTheDocument()

    auth.isAuthenticated = true
    rerender(
      <MemoryRouter>
        <IdleManager />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Sesión por expirar')).not.toBeInTheDocument()
  })
})

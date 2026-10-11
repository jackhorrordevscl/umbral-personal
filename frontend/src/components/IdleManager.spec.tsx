import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import IdleManager from './IdleManager'

const auth = { isAuthenticated: true, logout: vi.fn() }
vi.mock('../context/useAuth', () => ({ useAuth: () => auth }))

const navigate = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}))

let warn: () => void = () => {}
let expire: () => void = () => {}
let remoteActivity: () => void = () => {}
vi.mock('../hooks/useIdleTimeout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useIdleTimeout')>()),
  useIdleTimeout: ({
    onWarn,
    onExpire,
    onRemoteActivity,
  }: {
    onWarn: () => void
    onExpire: () => void
    onRemoteActivity: () => void
  }) => {
    warn = onWarn
    expire = onExpire
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
    auth.logout.mockClear()
    navigate.mockClear()
  })

  it('onExpire cierra la sesión y va a /login, como el botón del aviso (#367)', () => {
    renderManager()
    act(() => warn())

    act(() => expire())

    expect(auth.logout).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/login')
    expect(screen.queryByText('Sesión por expirar')).not.toBeInTheDocument()
  })

  it('onExpire no hace nada sin sesión', () => {
    auth.isAuthenticated = false
    renderManager()

    act(() => expire())

    expect(auth.logout).not.toHaveBeenCalled()
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

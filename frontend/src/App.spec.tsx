import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, Outlet } from 'react-router'
import App from './App'
import { useAuth } from './context/useAuth'

let unauthorizedHandler: (() => void) | null = null
vi.mock('./api/client', () => ({
  default: { post: vi.fn(() => Promise.resolve({})) },
  setUnauthorizedHandler: (handler: (() => void) | null) => {
    unauthorizedHandler = handler
    return () => {
      if (unauthorizedHandler === handler) unauthorizedHandler = null
    }
  },
}))

vi.mock('./components/IdleManager', () => ({ default: () => null }))
vi.mock('./components/Layout', () => ({ default: () => <Outlet /> }))
vi.mock('./pages/PatientsPage', () => ({
  default: function PatientsProbe() {
    const { logout } = useAuth()
    return (
      <>
        <p>Pacientes</p>
        <button onClick={() => logout()}>cerrar sesión</button>
      </>
    )
  },
}))
// Muestra el state con el que se llegó a /login.
vi.mock('./pages/LoginPage', () => ({
  default: function LoginProbe() {
    const location = useLocation()
    return <p data-testid="login-from">{JSON.stringify(location.state)}</p>
  },
}))

const user = { id: 'u1', email: 't@umbral.cl', role: 'THERAPIST', name: 'Ana' }

describe('App — redirección a login con state.from (issue #293)', () => {
  beforeEach(() => {
    localStorage.clear()
    unauthorizedHandler = null
    window.history.replaceState(null, '', '/')
  })

  it('PrivateRoute sin sesión envía a /login con la ruta de origen (path, query y hash)', async () => {
    window.history.replaceState(null, '', '/patients?tab=notas#n2')

    render(<App />)

    const probe = await screen.findByTestId('login-from')
    expect(JSON.parse(probe.textContent as string)).toEqual({
      from: '/patients?tab=notas#n2',
    })
    expect(window.location.pathname).toBe('/login')
  })

  it('el handler de 401 cierra la sesión y navega a /login con la ruta actual como from', async () => {
    localStorage.setItem('token', 'tok')
    localStorage.setItem('user', JSON.stringify(user))
    window.history.replaceState(null, '', '/patients?x=1')

    render(<App />)
    expect(await screen.findByText('Pacientes')).toBeInTheDocument()

    act(() => unauthorizedHandler?.())

    const probe = await screen.findByTestId('login-from')
    expect(JSON.parse(probe.textContent as string)).toEqual({
      from: '/patients?x=1',
    })
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('un logout voluntario no deja state.from en /login (issue #351)', async () => {
    localStorage.setItem('token', 'tok')
    localStorage.setItem('user', JSON.stringify(user))
    window.history.replaceState(null, '', '/patients?x=1')

    render(<App />)
    await userEvent.click(await screen.findByText('cerrar sesión'))

    const probe = await screen.findByTestId('login-from')
    expect(probe.textContent).toBe('null')
  })

  it('un logout hecho en otra pestaña no deja state.from en /login (issue #351)', async () => {
    localStorage.setItem('token', 'tok')
    localStorage.setItem('user', JSON.stringify(user))
    window.history.replaceState(null, '', '/patients?x=1')

    render(<App />)
    expect(await screen.findByText('Pacientes')).toBeInTheDocument()

    localStorage.removeItem('token')
    localStorage.removeItem('user')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'token' }))
    })

    const probe = await screen.findByTestId('login-from')
    expect(probe.textContent).toBe('null')
  })
})

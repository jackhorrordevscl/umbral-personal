import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../context/AuthContext'
import LoginPage from './LoginPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockNavigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockedApi = vi.mocked(api)

// AuthProvider vacía el QueryClient en login/logout (issue #291), así que
// necesita un QueryClientProvider por encima.
function TestProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <TestProviders>
        <LoginPage />
      </TestProviders>
    </MemoryRouter>,
  )
}

async function fillCredentials(email = 'user@umbral.cl', password = 'Password123!') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Contraseña'), password)
  await user.click(screen.getByRole('button', { name: /ingresar/i }))
  return user
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('login exitoso sin MFA guarda el token y navega al dashboard', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        accessToken: 'token-abc',
        user: { id: 'u1', email: 'user@umbral.cl', role: 'PROFESSIONAL', name: 'Test User' },
      },
    })

    renderLoginPage()
    await fillCredentials()

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
    expect(localStorage.getItem('token')).toBe('token-abc')
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', {
      email: 'user@umbral.cl',
      password: 'Password123!',
    })
  })

  it('credenciales inválidas muestra el mensaje de error del backend', async () => {
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: 'Credenciales inválidas' } },
    })

    renderLoginPage()
    await fillCredentials()

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('requiresMfa muestra el formulario de verificación MFA', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { requiresMfa: true, mfaToken: 'mfa-challenge-token' },
    })

    renderLoginPage()
    await fillCredentials()

    expect(
      await screen.findByText('Verificación MFA'),
    ).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('completa el flujo de verificación MFA y navega al dashboard', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { requiresMfa: true, mfaToken: 'mfa-challenge-token' },
    })
    mockedApi.post.mockResolvedValueOnce({
      data: {
        accessToken: 'token-mfa',
        user: { id: 'u1', email: 'user@umbral.cl', role: 'PROFESSIONAL', name: 'Test User' },
      },
    })

    renderLoginPage()
    const user = await fillCredentials()
    await screen.findByText('Verificación MFA')

    await user.type(
      screen.getByLabelText('Código de verificación MFA de 6 dígitos'),
      '123456',
    )
    await user.click(screen.getByRole('button', { name: /^verificar$/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
    expect(mockedApi.post).toHaveBeenLastCalledWith('/auth/mfa/verify', {
      mfaToken: 'mfa-challenge-token',
      token: '123456',
    })
    expect(localStorage.getItem('token')).toBe('token-mfa')
  })

  it('requiresMfaSetup inicia el enrolamiento y muestra el QR', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { requiresMfaSetup: true, setupToken: 'setup-token' },
    })
    mockedApi.post.mockResolvedValueOnce({
      data: { qrCode: 'data:image/png;base64,fake-qr' },
    })

    renderLoginPage()
    await fillCredentials()

    expect(
      await screen.findByText('Activación de MFA requerida'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/auth/mfa/setup/begin', {
        setupToken: 'setup-token',
      })
    })
    expect(screen.getByAltText('Código QR para configurar MFA')).toBeInTheDocument()
  })

  it('muestra el mensaje de redirección cuando location.state lo trae (ej. tras cambiar la contraseña en /settings)', () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/login',
            state: { message: 'Tu contraseña fue actualizada. Inicia sesión de nuevo.' },
          },
        ]}
      >
        <TestProviders>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </TestProviders>
      </MemoryRouter>,
    )

    expect(
      screen.getByText('Tu contraseña fue actualizada. Inicia sesión de nuevo.'),
    ).toBeInTheDocument()
  })

  it('con una sesión activa restaurada de localStorage redirige al dashboard en vez de mostrar el login', () => {
    localStorage.setItem('token', 'token-previo')
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'u1', email: 'user@umbral.cl', role: 'PROFESSIONAL', name: 'Test User' }),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <TestProviders>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<p>Panel</p>} />
          </Routes>
        </TestProviders>
      </MemoryRouter>,
    )

    expect(screen.getByText('Panel')).toBeInTheDocument()
    expect(screen.queryByText('Te damos la bienvenida')).not.toBeInTheDocument()
    localStorage.clear()
  })

  describe('destino tras el login (state.from, issue #293)', () => {
    const loginResponse = {
      data: {
        accessToken: 'token-abc',
        user: { id: 'u1', email: 'user@umbral.cl', role: 'PROFESSIONAL', name: 'Test User' },
      },
    }

    function renderWithFrom(from: unknown) {
      return render(
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { from } }]}>
          <TestProviders>
            <LoginPage />
          </TestProviders>
        </MemoryRouter>,
      )
    }

    it('navega a state.from si es una ruta interna', async () => {
      mockedApi.post.mockResolvedValueOnce(loginResponse)

      renderWithFrom('/patients/p1?tab=notas')
      await fillCredentials()

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/patients/p1?tab=notas')
      })
      expect(mockNavigate).not.toHaveBeenCalledWith('/dashboard')
    })

    it.each(['https://evil.example/', '//evil.example/', 'patients'])(
      'ignora un from no interno (%s) y va al dashboard',
      async (from) => {
        mockedApi.post.mockResolvedValueOnce(loginResponse)

        renderWithFrom(from)
        await fillCredentials()

        await waitFor(() => {
          expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
        })
      },
    )

    it('con una sesión restaurada redirige a state.from en vez de al dashboard', () => {
      localStorage.setItem('token', 'token-previo')
      localStorage.setItem(
        'user',
        JSON.stringify({ id: 'u1', email: 'user@umbral.cl', role: 'PROFESSIONAL', name: 'Test User' }),
      )

      render(
        <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/calendar' } }]}>
          <TestProviders>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/calendar" element={<p>Agenda</p>} />
              <Route path="/dashboard" element={<p>Panel</p>} />
            </Routes>
          </TestProviders>
        </MemoryRouter>,
      )

      expect(screen.getByText('Agenda')).toBeInTheDocument()
      localStorage.clear()
    })
  })

  it('requiresPasswordChange pide la nueva contraseña antes de continuar', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        requiresPasswordChange: true,
        passwordChangeToken: 'change-token',
      },
    })

    renderLoginPage()
    await fillCredentials()

    expect(
      await screen.findByText('Cambio de contraseña requerido'),
    ).toBeInTheDocument()
  })

  it('el cambio de contraseña inicial exige confirmar la nueva contraseña', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { requiresPasswordChange: true, passwordChangeToken: 'change-token' },
    })

    renderLoginPage()
    const user = await fillCredentials()
    await screen.findByText('Cambio de contraseña requerido')

    await user.type(screen.getByLabelText('Nueva contraseña'), 'NuevaPass123!')
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'OtraPass123!')
    await user.click(screen.getByRole('button', { name: /cambiar contraseña y continuar/i }))

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalledWith(
      '/auth/password/change',
      expect.anything(),
    )
  })

  it('normaliza el código MFA pegado con espacios', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { requiresMfa: true, mfaToken: 'mfa-challenge-token' },
    })

    renderLoginPage()
    const user = await fillCredentials()
    await screen.findByText('Verificación MFA')

    const input = screen.getByLabelText('Código de verificación MFA de 6 dígitos')
    await user.click(input)
    await user.paste('123 456')

    expect(input).toHaveValue('123456')
    expect(input).toHaveAttribute('inputmode', 'numeric')
  })

  it('si falla el inicio del enrolamiento MFA permite reintentar y volver', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { requiresMfaSetup: true, setupToken: 'setup-token' },
    })
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: 'Servicio no disponible' } },
    })
    mockedApi.post.mockResolvedValueOnce({
      data: { qrCode: 'data:image/png;base64,fake-qr' },
    })

    renderLoginPage()
    const user = await fillCredentials()

    expect(await screen.findByText('Servicio no disponible')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByAltText('Código QR para configurar MFA')).toBeInTheDocument()
    expect(screen.queryByText('Servicio no disponible')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /volver al inicio de sesión/i }))
    expect(screen.getByRole('button', { name: /^ingresar$/i })).toBeInTheDocument()
  })
})

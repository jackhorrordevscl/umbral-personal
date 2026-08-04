import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
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

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
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
      data: { requiresMfa: true, userId: 'u1' },
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
      data: { requiresMfa: true, userId: 'u1' },
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
      userId: 'u1',
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
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../context/AuthContext'
import SettingsPage from './SettingsPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockNavigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockedApi = vi.mocked(api)

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@umbral.cl',
    name: 'Test User',
    mfaEnabled: true,
    pendingEmail: null,
    ...overrides,
  }
}

function mockProfileGet(profile: ReturnType<typeof baseProfile>) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/profile') return Promise.resolve({ data: profile })
    if (url === '/profile/mfa-history') return Promise.resolve({ data: [] })
    return Promise.reject(new Error(`GET inesperado: ${url}`))
  })
}

describe('SettingsPage — datos de la cuenta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('token', 'token-abc')
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'user-1', email: 'user@umbral.cl', role: 'PROFESSIONAL', name: 'Test User' }),
    )
    mockProfileGet(baseProfile())
  })

  it('precarga el nombre actual desde GET /profile y lo actualiza con PATCH /profile', async () => {
    mockedApi.patch.mockResolvedValueOnce({
      data: baseProfile({ name: 'Nombre Nuevo' }),
    })

    renderPage()

    const nameInput = await screen.findByLabelText('Nombre')
    expect(nameInput).toHaveValue('Test User')

    const user = userEvent.setup()
    await user.clear(nameInput)
    await user.type(nameInput, 'Nombre Nuevo')
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }))

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith('/profile', { name: 'Nombre Nuevo' })
    })
    expect(await screen.findByText('Nombre actualizado correctamente.')).toBeInTheDocument()
  })

  it('cambio de email exitoso muestra el banner de pendingEmail con el valor de la respuesta', async () => {
    mockedApi.patch.mockResolvedValueOnce({
      data: baseProfile({ pendingEmail: 'nuevo@umbral.cl' }),
    })

    renderPage()
    await screen.findByLabelText('Nombre')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Nuevo email'), 'nuevo@umbral.cl')
    await user.type(
      screen.getByLabelText('Contraseña actual para cambiar email'),
      'CurrentPass123!',
    )
    await user.click(screen.getByRole('button', { name: 'Cambiar email' }))

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith('/profile', {
        email: 'nuevo@umbral.cl',
        currentPassword: 'CurrentPass123!',
      })
    })
    expect(
      await screen.findByText(
        'Tienes un cambio de email pendiente a nuevo@umbral.cl — revisa esa casilla para confirmarlo.',
      ),
    ).toBeInTheDocument()
  })

  it('al recargar con un pendingEmail ya existente, muestra el banner sin necesidad de enviar el formulario', async () => {
    mockProfileGet(baseProfile({ pendingEmail: 'otra@umbral.cl' }))

    renderPage()

    expect(
      await screen.findByText(
        'Tienes un cambio de email pendiente a otra@umbral.cl — revisa esa casilla para confirmarlo.',
      ),
    ).toBeInTheDocument()
  })

  it('currentPassword incorrecta en el cambio de email muestra el mensaje de error del backend', async () => {
    mockedApi.patch.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: 'Contraseña actual incorrecta' } },
    })

    renderPage()
    await screen.findByLabelText('Nombre')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Nuevo email'), 'nuevo@umbral.cl')
    await user.type(screen.getByLabelText('Contraseña actual para cambiar email'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Cambiar email' }))

    expect(await screen.findByText('Contraseña actual incorrecta')).toBeInTheDocument()
  })

  it('cambio de contraseña exitoso cierra sesión y redirige a /login con un mensaje', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: baseProfile() })

    renderPage()
    await screen.findByLabelText('Nombre')

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Nueva contraseña'), 'NuevaPassword789!')
    await user.type(
      screen.getByLabelText('Contraseña actual para cambiar contraseña'),
      'CurrentPass123!',
    )
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith('/profile', {
        password: 'NuevaPassword789!',
        currentPassword: 'CurrentPass123!',
      })
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', {
        state: { message: expect.stringContaining('contraseña') as string },
      })
    })
    expect(localStorage.getItem('token')).toBeNull()
  })
})

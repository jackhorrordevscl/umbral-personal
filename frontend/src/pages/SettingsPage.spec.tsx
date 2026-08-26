import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

function renderPage(initialEntries: string[] = ['/settings']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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

function baseCalendarStatus(overrides: Record<string, unknown> = {}) {
  return {
    status: 'PENDING',
    googleAccountEmail: null,
    connectedAt: null,
    lastSyncAt: null,
    lastError: null,
    ...overrides,
  }
}

function mockProfileGet(
  profile: ReturnType<typeof baseProfile>,
  calendarStatus: ReturnType<typeof baseCalendarStatus> = baseCalendarStatus(),
) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/profile') return Promise.resolve({ data: profile })
    if (url === '/profile/mfa-history') return Promise.resolve({ data: [] })
    if (url === '/calendar-integration/status')
      return Promise.resolve({ data: calendarStatus })
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

describe('SettingsPage — Google Calendar', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('token', 'token-abc')
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'user-1', email: 'user@umbral.cl', role: 'PROFESSIONAL', name: 'Test User' }),
    )
    mockProfileGet(baseProfile())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('muestra el botón de conexión cuando no hay conexión activa (PENDING)', async () => {
    mockProfileGet(baseProfile(), baseCalendarStatus({ status: 'PENDING' }))

    renderPage()

    expect(
      await screen.findByRole('button', { name: 'Conectar con Google Calendar' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desconectar' })).not.toBeInTheDocument()
  })

  it('clic en conectar llama a POST /authorize y redirige a la url devuelta', async () => {
    mockProfileGet(baseProfile(), baseCalendarStatus({ status: 'PENDING' }))
    mockedApi.post.mockResolvedValueOnce({
      data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc' },
    })

    renderPage()

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Conectar con Google Calendar' }),
    )

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/calendar-integration/authorize')
    })
    await waitFor(() => {
      expect(window.location.href).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc',
      )
    })
  })

  it('muestra el estado conectado y el botón de desconectar cuando status es CONNECTED', async () => {
    mockProfileGet(baseProfile(), baseCalendarStatus({ status: 'CONNECTED' }))

    renderPage()

    expect(await screen.findByText('Conectado')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Desconectar' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Conectar con Google Calendar' }),
    ).not.toBeInTheDocument()
  })

  it('clic en desconectar llama a POST /disconnect y vuelve a mostrar el botón de conectar', async () => {
    mockProfileGet(baseProfile(), baseCalendarStatus({ status: 'CONNECTED' }))
    mockedApi.post.mockResolvedValueOnce({ data: { status: 'DISCONNECTED' } })

    renderPage()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Desconectar' }))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/calendar-integration/disconnect')
    })
    expect(
      await screen.findByRole('button', { name: 'Conectar con Google Calendar' }),
    ).toBeInTheDocument()
  })

  it('muestra un banner de éxito cuando la URL de retorno trae ?calendar=connected', async () => {
    mockProfileGet(baseProfile(), baseCalendarStatus({ status: 'CONNECTED' }))

    renderPage(['/settings?calendar=connected'])

    expect(
      await screen.findByText('Tu cuenta de Google Calendar quedó conectada.'),
    ).toBeInTheDocument()
  })

  it('muestra un banner de error cuando la URL de retorno trae ?calendar=error', async () => {
    mockProfileGet(baseProfile(), baseCalendarStatus({ status: 'PENDING' }))

    renderPage(['/settings?calendar=error'])

    expect(
      await screen.findByText(
        'No se pudo conectar tu cuenta de Google Calendar. Intenta nuevamente.',
      ),
    ).toBeInTheDocument()
  })
})

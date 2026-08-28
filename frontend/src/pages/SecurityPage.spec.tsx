import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../context/AuthContext'
import SecurityPage from './SecurityPage'
import api from '../api/client'

// PR2b (session-calendar-view, account-settings Req: Security Section
// Scope, Req: OAuth Redirect Resolution): Seguridad quedó extraída de
// SettingsPage.tsx en PR2a sin cobertura propia -- SettingsPage.spec.tsx
// cubría ambas mitades juntas y se borró en PR2a (import roto, ./SettingsPage
// ya no existía). Este spec confirma el contrato de scope de esta página
// sola: MFA + panel completo de Google Calendar presentes, banner
// ?calendar=connected|error en ambos casos. No testea Calendario (PR4,
// todavía no existe) -- solo que Seguridad por sí sola trae el panel
// completo, que es lo que la spec exige ("MUST NOT be duplicated elsewhere").

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderSecurityPage(initialEntries: string[] = ['/security']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider>
          <SecurityPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
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

function mockGets(
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

describe('SecurityPage — account-settings Req: Security Section Scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('token', 'token-abc')
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'user-1',
        email: 'user@umbral.cl',
        role: 'PROFESSIONAL',
        name: 'Test User',
      }),
    )
    mockGets(baseProfile())
  })

  it('renderiza el panel de MFA', async () => {
    renderSecurityPage()

    expect(
      await screen.findByText('Autenticación de dos factores'),
    ).toBeInTheDocument()
    expect(screen.getByText('MFA activo')).toBeInTheDocument()
  })

  it('renderiza el panel completo de Google Calendar (conectar/desconectar/estado), sola', async () => {
    mockGets(baseProfile(), baseCalendarStatus({ status: 'PENDING' }))

    renderSecurityPage()

    expect(await screen.findByText('Google Calendar')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Conectar con Google Calendar' }),
    ).toBeInTheDocument()
  })

  it('con conexión CONNECTED, muestra el botón de desconectar (panel completo, no un badge de solo lectura)', async () => {
    mockGets(baseProfile(), baseCalendarStatus({ status: 'CONNECTED' }))

    renderSecurityPage()

    expect(await screen.findByText('Conectado')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Desconectar' }),
    ).toBeInTheDocument()
  })

  it('no muestra ningún campo de identidad de cuenta (nombre/email/password quedan en Perfil)', async () => {
    renderSecurityPage()

    await screen.findByText('Autenticación de dos factores')

    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Nuevo email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument()
  })
})

describe('SecurityPage — account-settings Req: OAuth Redirect Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('token', 'token-abc')
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'user-1',
        email: 'user@umbral.cl',
        role: 'PROFESSIONAL',
        name: 'Test User',
      }),
    )
    mockGets(baseProfile())
  })

  it('muestra un banner de éxito cuando la URL de retorno trae ?calendar=connected', async () => {
    renderSecurityPage(['/security?calendar=connected'])

    expect(
      await screen.findByText('Tu cuenta de Google Calendar quedó conectada.'),
    ).toBeInTheDocument()
  })

  it('muestra un banner de error cuando la URL de retorno trae ?calendar=error', async () => {
    renderSecurityPage(['/security?calendar=error'])

    expect(
      await screen.findByText(
        'No se pudo conectar tu cuenta de Google Calendar. Intenta nuevamente.',
      ),
    ).toBeInTheDocument()
  })
})

describe('SecurityPage — historial de seguridad', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('token', 'token-abc')
    localStorage.setItem(
      'user',
      JSON.stringify({
        id: 'user-1',
        email: 'user@umbral.cl',
        role: 'PROFESSIONAL',
        name: 'Test User',
      }),
    )
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

  it('clic en conectar llama a POST /authorize y redirige a la url devuelta', async () => {
    mockGets(baseProfile(), baseCalendarStatus({ status: 'PENDING' }))
    mockedApi.post.mockResolvedValueOnce({
      data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc' },
    })

    renderSecurityPage()

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Conectar con Google Calendar' }),
    )

    expect(mockedApi.post).toHaveBeenCalledWith('/calendar-integration/authorize')
  })
})

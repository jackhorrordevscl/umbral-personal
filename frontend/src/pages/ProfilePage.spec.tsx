import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../context/AuthContext'
import ProfilePage from './ProfilePage'
import api from '../api/client'

// PR2b (session-calendar-view, account-settings Req: Profile Section
// Scope): Perfil quedó extraída de SettingsPage.tsx en PR2a sin cobertura
// propia -- SettingsPage.spec.tsx cubría ambas mitades juntas y se borró en
// PR2a (habría quedado con un import roto al no existir más ./SettingsPage).
// Este spec confirma solo el contrato de scope: identidad (nombre/email/
// password) presente, MFA y Google Calendar ausentes -- el resto de los
// flujos de guardado ya están cubiertos en el historial de
// SettingsPage.spec.tsx original y no cambiaron de comportamiento en la
// extracción.

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderProfilePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/profile']}>
        <AuthProvider>
          <ProfilePage />
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

describe('ProfilePage — account-settings Req: Profile Section Scope', () => {
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
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/profile') return Promise.resolve({ data: baseProfile() })
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
  })

  it('renderiza los campos de identidad: nombre, email y contraseña', async () => {
    renderProfilePage()

    expect(await screen.findByLabelText('Nombre')).toBeInTheDocument()
    expect(screen.getByText('user@umbral.cl')).toBeInTheDocument()
    expect(screen.getByLabelText('Nuevo email')).toBeInTheDocument()
    expect(screen.getByLabelText('Nueva contraseña')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Guardar nombre' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cambiar email' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cambiar contraseña' }),
    ).toBeInTheDocument()
  })

  it('no muestra ningún control de MFA', async () => {
    renderProfilePage()

    await screen.findByLabelText('Nombre')

    expect(screen.queryByText(/MFA/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Autenticación de dos factores'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /código qr/i }),
    ).not.toBeInTheDocument()
  })

  it('no muestra ningún control de Google Calendar', async () => {
    renderProfilePage()

    await screen.findByLabelText('Nombre')

    expect(screen.queryByText('Google Calendar')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Conectar con Google Calendar' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Desconectar' }),
    ).not.toBeInTheDocument()
  })
})

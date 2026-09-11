import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
      // sdd/patient-self-scheduling PR 4 (tasks.md 4.3): ProfilePage ahora
      // también monta WeeklyScheduleEditor y BlockoutEditor, que fetchean su
      // propio recurso al montar -- sin este mock, esas dos queries caerían
      // en el catch-all de abajo y quedarían como promesas rechazadas sin
      // manejar en cada test de este archivo.
      if (url === '/availability/schedule') {
        return Promise.resolve({ data: { sessionDurationMinutes: 50, entries: [] } })
      }
      if (url === '/availability/blockouts') return Promise.resolve({ data: [] })
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

  // sdd/patient-self-scheduling PR 4 (tasks.md 4.3): confirma que el editor
  // de horario semanal y el de bloqueos quedan wireados en ProfilePage --
  // el detalle de su comportamiento (guardar/rechazar horario, agregar/
  // quitar bloqueo) está cubierto en sus propios specs (WeeklyScheduleEditor
  // .spec.tsx, BlockoutEditor.spec.tsx).
  it('incluye el editor de horario semanal y el de bloqueos de disponibilidad', async () => {
    renderProfilePage()

    expect(await screen.findByText('Horario semanal')).toBeInTheDocument()
    expect(
      screen.getByText('Bloqueos de disponibilidad'),
    ).toBeInTheDocument()
  })

  // El link antes había que armarlo a mano con el propio UUID de usuario --
  // complicado de conseguir para un terapeuta sin acceso a herramientas de
  // dev. Este test confirma que la página lo arma y lo deja copiable.
  it('muestra el link de auto-agenda con el id del profesional y permite copiarlo', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderProfilePage()

    const linkInput = await screen.findByDisplayValue(
      `${window.location.origin}/book/user-1`,
    )
    expect(linkInput).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /copiar/i }))

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/book/user-1`,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /copiado/i }),
      ).toBeInTheDocument(),
    )
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

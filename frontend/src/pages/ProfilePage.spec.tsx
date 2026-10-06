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

  it('la nueva contraseña exige confirmación: si no coincide avisa y no permite guardar', async () => {
    const user = userEvent.setup()
    renderProfilePage()

    await user.type(await screen.findByLabelText('Nueva contraseña'), 'NuevaPass123!')
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'Distinta123!')
    await user.type(
      screen.getByLabelText('Contraseña actual para cambiar contraseña'),
      'Actual123!',
    )

    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Confirmar nueva contraseña'))
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'NuevaPass123!')

    expect(screen.queryByText('Las contraseñas no coinciden.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeEnabled()
  })

  it('el mensaje de éxito del nombre desaparece al volver a editarlo', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: baseProfile({ name: 'Nuevo Nombre' }) })
    const user = userEvent.setup()
    renderProfilePage()

    const input = await screen.findByLabelText('Nombre')
    await user.clear(input)
    await user.type(input, 'Nuevo Nombre')
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }))
    expect(await screen.findByText('Nombre actualizado correctamente.')).toBeInTheDocument()

    await user.type(input, 'x')

    expect(screen.queryByText('Nombre actualizado correctamente.')).not.toBeInTheDocument()
  })

  it('tipear mientras el guardado del nombre está pendiente no descarta su resultado', async () => {
    let resolveSave: (value: unknown) => void = () => {}
    mockedApi.patch.mockImplementationOnce(
      () => new Promise(resolve => { resolveSave = resolve }),
    )
    const user = userEvent.setup()
    renderProfilePage()

    const input = await screen.findByLabelText('Nombre')
    await user.clear(input)
    await user.type(input, 'Nuevo Nombre')
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }))
    expect(await screen.findByRole('button', { name: 'Guardando...' })).toBeDisabled()

    await user.type(input, 'x')
    resolveSave({ data: baseProfile({ name: 'Nuevo Nombre' }) })

    expect(await screen.findByText('Nombre actualizado correctamente.')).toBeInTheDocument()
  })

  // Issue #294: con el perfil fallido las cards se montaban vacías y guardar
  // solo la bio enviaba specialty '' (borrando la guardada).
  it('si falla la carga del perfil no monta las cards editables y permite reintentar', async () => {
    const user = userEvent.setup()
    const defaultGet = mockedApi.get.getMockImplementation()!
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/profile') return Promise.reject(new Error('boom'))
      return defaultGet(url)
    })

    renderProfilePage()

    expect(
      await screen.findByText('No se pudieron cargar los datos de tu cuenta.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar perfil público' })).not.toBeInTheDocument()

    mockedApi.get.mockImplementation(defaultGet)
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByLabelText('Nombre')).toBeInTheDocument()
  })

  describe('sitio web del perfil público', () => {
    const URL_ERROR = 'Ingresa una URL válida que empiece con http:// o https://.'

    function mockProfile(overrides: Record<string, unknown>) {
      const defaultGet = mockedApi.get.getMockImplementation()!
      mockedApi.get.mockImplementation((url: string) => {
        if (url === '/profile') return Promise.resolve({ data: baseProfile(overrides) })
        return defaultGet(url)
      })
    }

    it('precarga el sitio web guardado y lo envía por PATCH al editarlo', async () => {
      mockProfile({ website: 'https://ana.cl' })
      mockedApi.patch.mockResolvedValueOnce({
        data: baseProfile({ website: 'https://nuevo.cl' }),
      })
      const user = userEvent.setup()
      renderProfilePage()

      const input = await screen.findByLabelText('Sitio web')
      expect(input).toHaveValue('https://ana.cl')
      expect(screen.getByRole('button', { name: 'Guardar perfil público' })).toBeDisabled()

      await user.clear(input)
      await user.type(input, 'https://nuevo.cl')
      await user.click(screen.getByRole('button', { name: 'Guardar perfil público' }))

      await waitFor(() =>
        expect(mockedApi.patch).toHaveBeenCalledWith(
          '/profile',
          expect.objectContaining({ website: 'https://nuevo.cl' }),
        ),
      )
      expect(await screen.findByText('Perfil público actualizado correctamente.')).toBeInTheDocument()
    })

    it('vaciar el campo envía website vacío para borrarlo', async () => {
      mockProfile({ website: 'https://ana.cl' })
      mockedApi.patch.mockResolvedValueOnce({ data: baseProfile({ website: null }) })
      const user = userEvent.setup()
      renderProfilePage()

      await user.clear(await screen.findByLabelText('Sitio web'))
      await user.click(screen.getByRole('button', { name: 'Guardar perfil público' }))

      await waitFor(() =>
        expect(mockedApi.patch).toHaveBeenCalledWith(
          '/profile',
          expect.objectContaining({ website: '' }),
        ),
      )
      expect(screen.queryByText(URL_ERROR)).not.toBeInTheDocument()
    })

    it('bloquea una URL inválida y muestra el mensaje sin llamar al backend', async () => {
      const user = userEvent.setup()
      renderProfilePage()

      await user.type(await screen.findByLabelText('Sitio web'), 'javascript:alert(1)')
      await user.click(screen.getByRole('button', { name: 'Guardar perfil público' }))

      expect(await screen.findByText(URL_ERROR)).toBeInTheDocument()
      expect(mockedApi.patch).not.toHaveBeenCalled()
    })

    it('un perfil sin el campo website no rompe y muestra el input vacío', async () => {
      renderProfilePage()

      expect(await screen.findByLabelText('Sitio web')).toHaveValue('')
    })
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
  it('muestra el link de auto-agenda con el id del profesional si no tiene slug y permite copiarlo', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

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

  it('arma el link de auto-agenda con el slug del profesional cuando existe', async () => {
    const defaultGet = mockedApi.get.getMockImplementation()!
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/profile') {
        return Promise.resolve({ data: baseProfile({ slug: 'test-user' }) })
      }
      return defaultGet(url)
    })

    renderProfilePage()

    expect(
      await screen.findByDisplayValue(`${window.location.origin}/book/test-user`),
    ).toBeInTheDocument()
  })

  // Issue #215: antes el catch estaba vacío y el usuario no se enteraba si el
  // navegador denegaba el permiso de portapapeles.
  it('avisa al usuario cuando el navegador deniega copiar al portapapeles', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    renderProfilePage()

    await userEvent.click(await screen.findByRole('button', { name: /copiar/i }))

    expect(
      await screen.findByRole('button', { name: /no se pudo copiar/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /copiado/i }),
    ).not.toBeInTheDocument()
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

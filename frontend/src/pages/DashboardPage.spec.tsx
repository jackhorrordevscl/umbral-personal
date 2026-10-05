import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import DashboardPage from './DashboardPage'
import api from '../api/client'

// issue #157 (T5): no había precedente de spec para DashboardPage.tsx antes
// de esta tarea -- este archivo es nuevo, acotado a probar la sección
// "Origen de pacientes" agregada (getAcquisitionStats) sin reescribir todo
// el resto del dashboard. useAuth se mockea (requiere AuthProvider real,
// que este test no necesita) y useNavigate solo necesita un Router alrededor.

vi.mock('../api/client', () => ({
  default: { get: vi.fn() },
}))

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'terapeuta@example.com', role: 'THERAPIST', name: 'Terapeuta' },
    token: 'token',
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: true,
  }),
}))

const mockedApi = vi.mocked(api)

const EMPTY_PAGE = { data: [], total: 0, page: 1, pageSize: 5 }

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardPage — issue #294 carga y error distintos de vacío', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mientras cargan pacientes y estadísticas muestra skeletons y no "No hay pacientes registrados aún."', async () => {
    mockedApi.get.mockImplementation(() => new Promise(() => {}))

    renderDashboard()

    expect(await screen.findByText('Cargando pacientes...')).toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(4)
    expect(screen.queryByText('No hay pacientes registrados aún.')).not.toBeInTheDocument()
  })

  it('si falla la carga de pacientes no muestra el vacío ni ceros, y permite reintentar', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.reject(new Error('boom'))
      if (url === '/patients/summary') return Promise.reject(new Error('boom'))
      if (url === '/consultations/stats') {
        return Promise.resolve({ data: { total: 7, upcoming: 2 } })
      }
      if (url === '/patients/stats/acquisition') return Promise.resolve({ data: [] })
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderDashboard()

    expect(await screen.findByText('No se pudieron cargar los pacientes.')).toBeInTheDocument()
    expect(screen.queryByText('No hay pacientes registrados aún.')).not.toBeInTheDocument()
    // Las tarjetas dependientes de pacientes muestran "—" en vez de 0.
    expect(screen.getAllByText('—')).toHaveLength(2)
    // Las de consultas siguen con su valor real.
    expect(screen.getByText('7')).toBeInTheDocument()

    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: EMPTY_PAGE })
      if (url === '/patients/summary') return Promise.resolve({ data: { total: 0, withConsent: 0 } })
      if (url === '/consultations/stats') {
        return Promise.resolve({ data: { total: 7, upcoming: 2 } })
      }
      if (url === '/patients/stats/acquisition') return Promise.resolve({ data: [] })
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('No hay pacientes registrados aún.')).toBeInTheDocument()
  })

  it('si falla la carga de estadísticas de consultas muestra "—" en vez de 0', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: EMPTY_PAGE })
      if (url === '/patients/summary') return Promise.resolve({ data: { total: 0, withConsent: 0 } })
      if (url === '/consultations/stats') return Promise.reject(new Error('boom'))
      if (url === '/patients/stats/acquisition') return Promise.resolve({ data: [] })
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderDashboard()

    expect(await screen.findByText(/no se pudieron cargar algunas estadísticas/i)).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })
})

describe('DashboardPage — issue #157 sección "Origen de pacientes"', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el desglose por canal en el orden que devuelve el backend', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: EMPTY_PAGE })
      if (url === '/patients/summary') return Promise.resolve({ data: { total: 0, withConsent: 0 } })
      if (url === '/consultations/stats') {
        return Promise.resolve({ data: { total: 0, upcoming: 0 } })
      }
      if (url === '/patients/stats/acquisition') {
        return Promise.resolve({
          data: [
            { source: 'instagram', count: 5 },
            { source: 'directo', count: 2 },
          ],
        })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderDashboard()

    expect(await screen.findByText('instagram')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('directo')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('sin datos de origen todavía, muestra el mensaje de estado vacío', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: EMPTY_PAGE })
      if (url === '/patients/summary') return Promise.resolve({ data: { total: 0, withConsent: 0 } })
      if (url === '/consultations/stats') {
        return Promise.resolve({ data: { total: 0, upcoming: 0 } })
      }
      if (url === '/patients/stats/acquisition') return Promise.resolve({ data: [] })
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderDashboard()

    expect(await screen.findByText('Sin datos de origen todavía.')).toBeInTheDocument()
  })

  it('un error al cargar el origen no rompe el resto del dashboard', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: EMPTY_PAGE })
      if (url === '/patients/summary') return Promise.resolve({ data: { total: 0, withConsent: 0 } })
      if (url === '/consultations/stats') {
        return Promise.resolve({ data: { total: 0, upcoming: 0 } })
      }
      if (url === '/patients/stats/acquisition') return Promise.reject(new Error('boom'))
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderDashboard()

    expect(await screen.findByText('No se pudo cargar el origen de pacientes.')).toBeInTheDocument()
    // El resto del dashboard sigue renderizando con normalidad (sin el
    // banner grande de error, reservado a patients/consultas).
    expect(screen.queryByText(/no se pudieron cargar algunas estadísticas/i)).not.toBeInTheDocument()
    expect(screen.getByText('Pacientes recientes')).toBeInTheDocument()
  })
})

describe('DashboardPage — issue #290 contadores y recientes desde el servidor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('los contadores salen de /patients/summary (no de contar la lista) y los recientes piden solo 5', async () => {
    const recent = [
      { id: 'p1', fullName: 'Reciente Uno', rut: '11111111-1', consents: { TREATMENT: true, TELEMEDICINE: false } },
      { id: 'p2', fullName: 'Reciente Dos', rut: '22222222-2', consents: { TREATMENT: false, TELEMEDICINE: false } },
    ]
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') {
        return Promise.resolve({ data: { data: recent, total: 731, page: 1, pageSize: 5 } })
      }
      if (url === '/patients/summary') {
        return Promise.resolve({ data: { total: 731, withConsent: 612 } })
      }
      if (url === '/consultations/stats') {
        return Promise.resolve({ data: { total: 0, upcoming: 0 } })
      }
      if (url === '/patients/stats/acquisition') return Promise.resolve({ data: [] })
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderDashboard()

    expect(await screen.findByText('731')).toBeInTheDocument()
    expect(screen.getByText('612')).toBeInTheDocument()
    expect(screen.getByText('Reciente Uno')).toBeInTheDocument()
    expect(screen.getByText('Reciente Dos')).toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledWith('/patients', {
      params: { page: 1, pageSize: 5, search: undefined },
    })
  })
})


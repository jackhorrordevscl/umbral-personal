import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

describe('DashboardPage — issue #157 sección "Origen de pacientes"', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el desglose por canal en el orden que devuelve el backend', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [] })
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
      if (url === '/patients') return Promise.resolve({ data: [] })
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
      if (url === '/patients') return Promise.resolve({ data: [] })
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

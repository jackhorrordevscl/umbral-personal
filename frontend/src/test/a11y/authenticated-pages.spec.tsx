import { describe, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from '../../components/Layout'
import DashboardPage from '../../pages/DashboardPage'
import ConsultationsPage from '../../pages/ConsultationsPage'
import PaymentsPage from '../../pages/PaymentsPage'
import PatientsPage from '../../pages/PatientsPage'
import api from '../../api/client'
import type { Patient } from '../../types/patient'
import { expectNoA11yViolations } from '../axe'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('../../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'terapeuta@example.com', role: 'THERAPIST', name: 'Terapeuta' },
    token: 'token',
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: true,
  }),
}))
vi.mock('../../components/notifications/NotificationBell', () => ({ default: () => null }))

const mockedApi = vi.mocked(api)

const PATIENT = {
  id: 'patient-1',
  fullName: 'Paciente de Prueba',
  rut: '11111111-1',
  birthDate: '1990-01-01',
  consents: { TREATMENT: true, TELEMEDICINE: false },
} as unknown as Patient

const PATIENTS_PAGE = { data: [PATIENT], total: 1, page: 1, pageSize: 50 }

function mockApi() {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/patients') return Promise.resolve({ data: PATIENTS_PAGE })
    if (url === '/patients/summary') return Promise.resolve({ data: { total: 1, withConsent: 1 } })
    if (url === '/consultations/stats') return Promise.resolve({ data: { total: 3, upcoming: 1 } })
    if (url === '/patients/stats/acquisition') return Promise.resolve({ data: [] })
    if (url === '/payments/account') {
      return Promise.resolve({
        data: {
          status: 'PENDING',
          provider: 'FLOW',
          displayName: null,
          keyFingerprint: null,
          connectedAt: null,
          lastError: null,
        },
      })
    }
    return Promise.resolve({ data: [] })
  })
}

function renderPage(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('a11y: authenticated pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi()
  })

  it('Layout shell with the skip link has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<h1>Contenido</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Saltar al contenido')
    await expectNoA11yViolations(container)
  })

  it('DashboardPage has no axe violations', async () => {
    const { container } = renderPage(<DashboardPage />)
    await screen.findAllByText('Paciente de Prueba')
    await expectNoA11yViolations(container)
  })

  it('ConsultationsPage has no axe violations', async () => {
    const { container } = renderPage(<ConsultationsPage />)
    await screen.findByText('Paciente de Prueba')
    await expectNoA11yViolations(container)
  })

  it('PaymentsPage has no axe violations', async () => {
    const { container } = renderPage(<PaymentsPage />)
    await screen.findByRole('button', { name: /comenzar/i })
    await expectNoA11yViolations(container)
  })

  it('PatientsPage (virtualized table and cards) has no axe violations', async () => {
    const { container } = renderPage(<PatientsPage />)
    // Both lists are in the DOM at once (CSS hides one); wait for rows to mount in each.
    expect(await screen.findAllByText('Paciente de Prueba')).toHaveLength(2)
    await expectNoA11yViolations(container)
  })
})

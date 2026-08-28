import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CalendarPage from './CalendarPage'
import api from '../api/client'
import type { Patient } from '../types/patient'
import type { CalendarSession } from '../api/consultations'

// PR4 (session-calendar-view, tasks.md Phase 5, task 5.10): RED cubriendo
// las 4 escenarios exigidos -- bucketing por día de Chile a través del DST
// (spring-forward derivado empíricamente en PR1: 2026-09-06T04:00:00Z), el
// grid con celdas de spillover, el modal de detalle de día solo lectura
// (sin editar/cancelar), y el badge de Google Calendar sin control inline
// (session-calendar Req: Month Range Read Endpoint, Session Date Anchoring,
// Read-Only Day Detail Modal, Google Calendar Status Badge).

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildSession(overrides: Partial<CalendarSession> = {}): CalendarSession {
  return {
    id: 'c1',
    groupId: 'c1',
    sessionDate: '2026-09-10T16:00:00-03:00',
    sessionType: 'IN_PERSON',
    patientId: 'p1',
    patientName: 'Paciente Solo',
    calendarSync: null,
    ...overrides,
  }
}

function buildPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'p1',
    fullName: 'Paciente Solo',
    rut: '11111111-1',
    birthDate: '1990-01-01',
    consents: { TREATMENT: true, TELEMEDICINE: false },
    ...overrides,
  } as unknown as Patient
}

function baseCalendarStatus(overrides: Record<string, unknown> = {}) {
  return {
    status: 'CONNECTED',
    googleAccountEmail: 'therapist@gmail.com',
    connectedAt: '2026-08-01T00:00:00Z',
    lastSyncAt: '2026-09-01T00:00:00Z',
    lastError: null,
    ...overrides,
  }
}

function mockGets(
  sessions: CalendarSession[],
  calendarStatus: ReturnType<typeof baseCalendarStatus> = baseCalendarStatus(),
) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/consultations/range') return Promise.resolve({ data: sessions })
    if (url === '/calendar-integration/status')
      return Promise.resolve({ data: calendarStatus })
    if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
    return Promise.reject(new Error(`GET inesperado: ${url}`))
  })
}

function renderCalendarPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/calendar']}>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Ancla "hoy" en septiembre 2026 (mes con boundary DST) para que la
    // vista por defecto sea ese mes, sin depender del reloj real. Solo se
    // fakea Date -- setTimeout/microtasks siguen reales para
    // userEvent/react-query.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T15:00:00-03:00'))
    mockGets([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pide el rango exacto del grid 6x7 de septiembre 2026 (cruza el spring-forward)', async () => {
    renderCalendarPage()

    await screen.findByTestId('day-cell-2026-09-01')

    expect(mockedApi.get).toHaveBeenCalledWith('/consultations/range', {
      params: { from: '2026-08-31T00:00:00-04:00', to: '2026-10-12T00:00:00-03:00' },
    })
  })

  it('renderiza las celdas de spillover del mes adyacente (agosto y octubre)', async () => {
    renderCalendarPage()

    expect(await screen.findByTestId('day-cell-2026-08-31')).toBeInTheDocument()
    expect(screen.getByTestId('day-cell-2026-10-11')).toBeInTheDocument()
  })

  it('bucketea sesiones por día de Chile a través del spring-forward, no por día UTC naive', async () => {
    mockGets([
      buildSession({
        id: 'antes',
        groupId: 'antes',
        sessionDate: '2026-09-06T03:59:00.000Z', // Chile -04:00 -> 2026-09-05 23:59
        patientName: 'Paciente Borde Antes',
      }),
      buildSession({
        id: 'despues',
        groupId: 'despues',
        sessionDate: '2026-09-06T04:00:00.000Z', // Chile -03:00 -> 2026-09-06 01:00
        patientName: 'Paciente Borde Después',
      }),
    ])

    renderCalendarPage()

    const cellAntes = await screen.findByTestId('day-cell-2026-09-05')
    const cellDespues = await screen.findByTestId('day-cell-2026-09-06')

    expect(within(cellAntes).getByText(/Paciente Borde Antes/)).toBeInTheDocument()
    expect(within(cellDespues).getByText(/Paciente Borde Después/)).toBeInTheDocument()
    expect(within(cellAntes).queryByText(/Paciente Borde Después/)).not.toBeInTheDocument()
    expect(within(cellDespues).queryByText(/Paciente Borde Antes/)).not.toBeInTheDocument()
  })

  it('una celda con más de 3 sesiones muestra 3 chips y el overflow "+N más"', async () => {
    mockGets([
      buildSession({ id: 's1', groupId: 's1', sessionDate: '2026-09-20T13:00:00-03:00', patientName: 'Paciente Uno' }),
      buildSession({ id: 's2', groupId: 's2', sessionDate: '2026-09-20T14:00:00-03:00', patientName: 'Paciente Dos' }),
      buildSession({ id: 's3', groupId: 's3', sessionDate: '2026-09-20T15:00:00-03:00', patientName: 'Paciente Tres' }),
      buildSession({ id: 's4', groupId: 's4', sessionDate: '2026-09-20T16:00:00-03:00', patientName: 'Paciente Cuatro' }),
    ])

    renderCalendarPage()

    const cell = await screen.findByTestId('day-cell-2026-09-20')
    expect(await within(cell).findByText(/Paciente Uno/)).toBeInTheDocument()
    expect(within(cell).getByText(/Paciente Dos/)).toBeInTheDocument()
    expect(within(cell).getByText(/Paciente Tres/)).toBeInTheDocument()
    expect(within(cell).queryByText(/Paciente Cuatro/)).not.toBeInTheDocument()
    expect(within(cell).getByText(/\+1 más/)).toBeInTheDocument()
  })

  it('el modal de detalle de día es de solo lectura: lista sesiones sin controles de editar ni cancelar', async () => {
    mockGets([buildSession()])
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    renderCalendarPage()

    const cell = await screen.findByTestId('day-cell-2026-09-10')
    await user.click(cell)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText('Paciente Solo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /corregir/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancelar sesión/i })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /agendar sesión/i }),
    ).toBeInTheDocument()
  })

  it('"Agendar sesión" abre el formulario clínico existente, precargado con la fecha del día', async () => {
    mockGets([buildSession()])
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    renderCalendarPage()

    const cell = await screen.findByTestId('day-cell-2026-09-10')
    await user.click(cell)
    await user.click(await screen.findByRole('button', { name: /agendar sesión/i }))

    expect(await screen.findByLabelText(/motivo de consulta/i)).toBeInTheDocument()
    expect(await screen.findByLabelText(/intervención realizada/i)).toBeInTheDocument()
    const sessionDateInput = document.getElementById(
      'consult-sessionDate',
    ) as HTMLInputElement
    expect(sessionDateInput.value).toBe('2026-09-10')
  })

  it('el badge de Google Calendar solo muestra estado y enlaza a Seguridad, sin conectar/desconectar', async () => {
    mockGets([], baseCalendarStatus({ status: 'CONNECTED' }))

    renderCalendarPage()

    const badge = await screen.findByTestId('calendar-sync-badge')
    await within(badge).findByText(/conectado/i)
    expect(badge).toHaveAttribute('href', '/security')
    expect(within(badge).queryByRole('button', { name: /conectar/i })).not.toBeInTheDocument()
    expect(within(badge).queryByRole('button', { name: /desconectar/i })).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import PublicBookingPage from './PublicBookingPage'
import api from '../api/client'
import { toChileDayKey } from '../utils/datetime'

// sdd/patient-self-scheduling PR 5 (tasks.md 5.2/5.4, public-scheduling Req:
// "Public Availability Read Endpoint" + "Double-Booking Protection"): página
// pública SIN AuthProvider/JWT (renderizada directa, sin envolver en
// AuthProvider ni mockear useAuth -- debe funcionar para un visitante sin
// sesión). No usa localStorage para token, así que api/client.ts nunca
// agrega Authorization.

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

// Slot fijo dentro del rango de la grilla del mes actual (chileMonthGridRange
// usa "hoy" en Chile como ancla) -- se calcula relativo a "ahora" para no
// quedar fuera del grid 6x7 ni del horizonte de 60 días al pasar el tiempo.
function futureSlotOnChileDay(daysAhead: number, hourUTC: number) {
  const base = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)
  base.setUTCHours(hourUTC, 0, 0, 0)
  const start = base.toISOString()
  const end = new Date(base.getTime() + 50 * 60000).toISOString()
  return { start, end, dayKey: toChileDayKey(start) }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/book/therapist-1']}>
        <Routes>
          <Route path="/book/:therapistId" element={<PublicBookingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PublicBookingPage — public-scheduling Req: Public Availability Read Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra los horarios disponibles del día seleccionado', async () => {
    const slot = futureSlotOnChileDay(5, 13) // 13:00 UTC -> 09:00/10:00 Chile (invierno) o 10:00/11:00 (verano)
    mockedApi.get.mockImplementation((url: string) => {
      if (url === `/public/therapists/therapist-1/availability`) {
        return Promise.resolve({ data: [slot] })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderPage()

    const dayButton = await screen.findByRole('button', {
      name: `Ver horarios del ${slot.dayKey}`,
    })
    await userEvent.setup().click(dayButton)

    const grid = await screen.findByRole('group', { name: 'Horarios disponibles' })
    expect(within(grid).getAllByRole('button')).toHaveLength(1)
  })

  it('un 409 al confirmar la reserva refresca la disponibilidad y avisa que el horario ya no está libre', async () => {
    const slot = futureSlotOnChileDay(6, 13)
    mockedApi.get.mockImplementation((url: string) => {
      if (url === `/public/therapists/therapist-1/availability`) {
        return Promise.resolve({ data: [slot] })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    mockedApi.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { message: 'ya no disponible' } },
    })

    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole('button', { name: `Ver horarios del ${slot.dayKey}` }),
    )

    const grid = await screen.findByRole('group', { name: 'Horarios disponibles' })
    await user.click(within(grid).getAllByRole('button')[0])

    await user.type(screen.getByLabelText(/nombre completo/i), 'Juana Pérez')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
    await user.type(screen.getByLabelText(/fecha de nacimiento/i), '1990-05-01')
    await user.type(screen.getByLabelText(/^email/i), 'choque@example.com')
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() =>
      expect(
        screen.getByText('Ese horario ya no está disponible. Elige otro horario libre.'),
      ).toBeInTheDocument(),
    )
    // El refetch dispara una segunda llamada GET a disponibilidad.
    await waitFor(() =>
      expect(
        mockedApi.get.mock.calls.filter(
          ([url]) => url === '/public/therapists/therapist-1/availability',
        ).length,
      ).toBeGreaterThanOrEqual(2),
    )
  })
})

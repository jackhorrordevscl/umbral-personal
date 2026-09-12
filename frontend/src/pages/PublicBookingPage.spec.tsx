import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import PublicBookingPage, {
  CHECKOUT_POLL_INTERVAL_MS,
  CHECKOUT_POLL_TIMEOUT_MS,
} from './PublicBookingPage'
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

function renderPage(initialEntry = '/book/therapist-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/book/:therapistId" element={<PublicBookingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.4): completa el flujo
// real de reserva (mismo camino que el test de 409 ya existente) hasta que
// aparece la confirmación -- reusado por los tests de checkout polling para
// no duplicar los 6 pasos de UI en cada uno.
async function bookSlotUntilConfirmed(
  user: ReturnType<typeof userEvent.setup>,
  slot: { dayKey: string },
) {
  await user.click(
    await screen.findByRole('button', { name: `Ver horarios del ${slot.dayKey}` }),
  )
  const grid = await screen.findByRole('group', { name: 'Horarios disponibles' })
  await user.click(within(grid).getAllByRole('button')[0])

  await user.type(screen.getByLabelText(/nombre completo/i), 'Juana Pérez')
  await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
  await user.type(screen.getByLabelText(/fecha de nacimiento/i), '1990-05-01')
  await user.type(screen.getByLabelText(/^email/i), 'juana@example.com')
  await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

  await screen.findByText('¡Listo!')
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

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.4, design.md
// Decision 5 "Checkout is polled, not awaited"): el flujo de reserva usa
// timers reales (mismo criterio que el describe de arriba, con userEvent
// sin fake timers) hasta llegar a la confirmación -- recién ahí se activan
// fake timers, ACOTADOS a esta sección, para controlar de forma
// determinística el intervalo de 2s / techo de 15s del polling sin esperar
// tiempo real en la corrida de tests.
describe('PublicBookingPage — public-scheduling Req: Booking Confirmation Surfaces the Checkout Link In-Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Estos dos tests corren en tiempo real (sin fake timers): el intento de
  // activar fake timers a mitad de camino (después de llegar a la
  // confirmación) deja el primer `setTimeout` del polling agendado en el
  // reloj REAL sin que `vi.advanceTimersByTimeAsync` pueda adelantarlo
  // -- comprobado empíricamente (el CTA nunca aparecía) --, y activarlos
  // desde antes de renderizar cuelga `findBy`/`waitFor` de
  // @testing-library/dom, que dependen de su propio polling con timers
  // reales para resolver. CHECKOUT_POLL_INTERVAL_MS/CHECKOUT_POLL_TIMEOUT_MS
  // son chicos (2s/15s) -- esperar en tiempo real es la forma confiable de
  // probar el comportamiento real, al costo de que estos dos tests tardan
  // más que el resto del archivo.
  it(
    'checkout PENDING: pollea y muestra el CTA de pago cuando aparece un paymentUrl',
    async () => {
      const slot = futureSlotOnChileDay(7, 13)
      mockedApi.get.mockImplementation((url: string) => {
        if (url === `/public/therapists/therapist-1/availability`) {
          return Promise.resolve({ data: [slot] })
        }
        if (
          url ===
          '/public/therapists/therapist-1/availability/book/group-1/checkout'
        ) {
          return Promise.resolve({
            data: { paymentUrl: 'https://flow.cl/pay/abc', amount: 30000 },
          })
        }
        return Promise.reject(new Error(`GET inesperado: ${url}`))
      })
      mockedApi.post.mockResolvedValue({
        data: {
          id: 'consult-1',
          groupId: 'group-1',
          sessionDate: slot.start,
          checkout: { status: 'PENDING' },
        },
      })

      const user = userEvent.setup()
      renderPage()
      await bookSlotUntilConfirmed(user, slot)

      // Todavía no arrancó el primer tick del poll (CHECKOUT_POLL_INTERVAL_MS)
      // -- el CTA no debe existir antes de eso.
      expect(screen.queryByRole('link', { name: 'Pagar ahora' })).not.toBeInTheDocument()

      const link = await screen.findByRole(
        'link',
        { name: 'Pagar ahora' },
        { timeout: CHECKOUT_POLL_INTERVAL_MS + 2000 },
      )
      expect(link).toHaveAttribute('href', 'https://flow.cl/pay/abc')
      expect(screen.getByText(/vas a salir de esta página/i)).toBeInTheDocument()
    },
    CHECKOUT_POLL_INTERVAL_MS + 5000,
  )

  it(
    'checkout PENDING: si el polling se agota sin paymentUrl, cae al texto de aviso por email',
    async () => {
      const slot = futureSlotOnChileDay(8, 13)
      mockedApi.get.mockImplementation((url: string) => {
        if (url === `/public/therapists/therapist-1/availability`) {
          return Promise.resolve({ data: [slot] })
        }
        if (
          url ===
          '/public/therapists/therapist-1/availability/book/group-1/checkout'
        ) {
          return Promise.resolve({ data: { paymentUrl: null } })
        }
        return Promise.reject(new Error(`GET inesperado: ${url}`))
      })
      mockedApi.post.mockResolvedValue({
        data: {
          id: 'consult-1',
          groupId: 'group-1',
          sessionDate: slot.start,
          checkout: { status: 'PENDING' },
        },
      })

      const user = userEvent.setup()
      renderPage()
      await bookSlotUntilConfirmed(user, slot)

      await waitFor(
        () =>
          expect(
            screen.getByText(/te vamos a enviar el link de pago a tu email/i),
          ).toBeInTheDocument(),
        { timeout: CHECKOUT_POLL_TIMEOUT_MS + 3000 },
      )
      expect(screen.queryByRole('link', { name: 'Pagar ahora' })).not.toBeInTheDocument()
    },
    CHECKOUT_POLL_TIMEOUT_MS + 8000,
  )

  it('checkout NOT_APPLICABLE no dispara ningún polling ni muestra el CTA de pago', async () => {
    const slot = futureSlotOnChileDay(9, 13)
    mockedApi.get.mockImplementation((url: string) => {
      if (url === `/public/therapists/therapist-1/availability`) {
        return Promise.resolve({ data: [slot] })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    mockedApi.post.mockResolvedValue({
      data: {
        id: 'consult-1',
        groupId: 'group-1',
        sessionDate: slot.start,
        checkout: { status: 'NOT_APPLICABLE' },
      },
    })

    const user = userEvent.setup()
    renderPage()
    await bookSlotUntilConfirmed(user, slot)

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_POLL_TIMEOUT_MS + CHECKOUT_POLL_INTERVAL_MS)
    })
    vi.useRealTimers()

    expect(
      mockedApi.get.mock.calls.some(([url]) => String(url).includes('/checkout')),
    ).toBe(false)
    expect(screen.queryByRole('link', { name: 'Pagar ahora' })).not.toBeInTheDocument()
    expect(
      screen.queryByText(/te vamos a enviar el link de pago a tu email/i),
    ).not.toBeInTheDocument()
  })

  it('checkout ausente (flag apagado en el backend) tampoco dispara polling ni CTA', async () => {
    const slot = futureSlotOnChileDay(10, 13)
    mockedApi.get.mockImplementation((url: string) => {
      if (url === `/public/therapists/therapist-1/availability`) {
        return Promise.resolve({ data: [slot] })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    mockedApi.post.mockResolvedValue({
      data: { id: 'consult-1', groupId: 'group-1', sessionDate: slot.start },
    })

    const user = userEvent.setup()
    renderPage()
    await bookSlotUntilConfirmed(user, slot)

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKOUT_POLL_TIMEOUT_MS + CHECKOUT_POLL_INTERVAL_MS)
    })
    vi.useRealTimers()

    expect(
      mockedApi.get.mock.calls.some(([url]) => String(url).includes('/checkout')),
    ).toBe(false)
    expect(screen.queryByRole('link', { name: 'Pagar ahora' })).not.toBeInTheDocument()
  })
})

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.5, spec.md "Flow
// return arrival displays confirmation state, not payment status"): fallback
// defensivo -- el retorno real de Flow nunca apunta acá (design.md Decisión
// 2), pero un link viejo/stale con ?flow_return=1 no debe romper ni asumir
// nada sobre el pago.
describe('PublicBookingPage — public-scheduling Req: Flow return arrival displays confirmation state, not payment status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flow_return=1 sin reserva local en esta sesión muestra confirmación sin afirmar el estado del pago', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === `/public/therapists/therapist-1/availability`) {
        return Promise.resolve({ data: [] })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderPage('/book/therapist-1?flow_return=1')

    expect(await screen.findByText('¡Listo!')).toBeInTheDocument()
    // No debe renderizar el picker de calendario (se saltea directo a la
    // confirmación defensiva).
    expect(screen.queryByRole('button', { name: 'Mes anterior' })).not.toBeInTheDocument()
    // No debe afirmar nada sobre el estado del pago -- ni CTA de pago, ni
    // aviso de que el pago falló o quedó confirmado.
    expect(screen.queryByRole('link', { name: 'Pagar ahora' })).not.toBeInTheDocument()
  })

  it('sin flow_return, la página muestra el picker de calendario normalmente', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === `/public/therapists/therapist-1/availability`) {
        return Promise.resolve({ data: [] })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderPage('/book/therapist-1')

    expect(await screen.findByRole('button', { name: 'Mes anterior' })).toBeInTheDocument()
    expect(screen.queryByText('¡Listo!')).not.toBeInTheDocument()
  })
})

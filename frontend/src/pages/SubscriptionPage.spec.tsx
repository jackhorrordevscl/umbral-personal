import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { SubscriptionScreen } from './SubscriptionPage'
import api from '../api/client'
import type { SubscriptionStatus } from '../hooks/useSubscription'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildStatus(overrides: Partial<SubscriptionStatus> = {}): SubscriptionStatus {
  return {
    enforced: true,
    state: 'ACTIVE',
    periodEnd: '2026-12-01T15:00:00.000Z',
    graceEnd: null,
    priceClp: 6990,
    ...overrides,
  }
}

function renderPage(props: { afterPayment?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubscriptionScreen {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, queryClient }
}

describe('SubscriptionPage (issue #611)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('con el interruptor apagado avisa que la suscripción todavía no se cobra y no ofrece pagar', async () => {
    mockedApi.get.mockResolvedValue({ data: buildStatus({ enforced: false }) })

    renderPage()

    expect(await screen.findByText(/todavía no está activa/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pagar/i })).not.toBeInTheDocument()
  })

  it('cuenta vigente: muestra la fecha de vencimiento y el precio, y permite adelantar un mes', async () => {
    mockedApi.get.mockResolvedValue({ data: buildStatus() })

    renderPage()

    expect(await screen.findByText(/vigente hasta el 1 de diciembre de 2026/i)).toBeInTheDocument()
    expect(screen.getByText(/\$6\.990/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pagar un mes más/i })).toBeInTheDocument()
  })

  it('período de gracia: explica hasta cuándo se puede renovar antes del solo lectura', async () => {
    mockedApi.get.mockResolvedValue({
      data: buildStatus({
        state: 'GRACE',
        periodEnd: '2026-11-01T15:00:00.000Z',
        graceEnd: '2026-11-08T15:00:00.000Z',
      }),
    })

    renderPage()

    expect(await screen.findByText(/venció el 1 de noviembre de 2026/i)).toBeInTheDocument()
    expect(screen.getByText(/hasta el 8 de noviembre de 2026/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pagar suscripción/i })).toBeInTheDocument()
  })

  it('solo lectura: indica que se puede consultar pero no registrar cambios', async () => {
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })

    renderPage()

    expect(await screen.findByText(/solo lectura/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pagar suscripción/i })).toBeInTheDocument()
  })

  it('cuenta exenta permanente: informa acceso sin costo y no ofrece pagar', async () => {
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'EXEMPT', periodEnd: null }),
    })

    renderPage()

    expect(await screen.findByText(/acceso sin costo/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pagar/i })).not.toBeInTheDocument()
  })

  it('al pagar crea el checkout y envía el navegador a la URL de Flow', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })
    mockedApi.post.mockResolvedValue({
      data: { paymentUrl: 'https://flow.example/pay?token=abc' },
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: /pagar suscripción/i }))

    expect(mockedApi.post).toHaveBeenCalledWith('/billing/checkout')
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://flow.example/pay?token=abc'),
    )
  })

  it('tras crear el checkout mantiene el botón deshabilitado mientras el navegador navega a Flow', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })
    mockedApi.post.mockResolvedValue({
      data: { paymentUrl: 'https://flow.example/pay?token=abc' },
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: /pagar suscripción/i }))
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))

    expect(screen.getByRole('button', { name: /redirigiendo a flow/i })).toBeDisabled()
  })

  it('si un refetch falla con datos ya cargados, conserva el estado y el botón de pago', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })
    mockedApi.get.mockRejectedValue(new Error('network'))

    const { queryClient } = renderPage()
    expect(await screen.findByRole('button', { name: /pagar suscripción/i })).toBeInTheDocument()

    await act(async () => {
      await queryClient.refetchQueries()
    })
    // Precondición: el refetch realmente falló y la query quedó en error.
    expect(queryClient.getQueryCache().getAll()[0].state.status).toBe('error')
    // Deja que React pinte el estado de error antes de comprobar la pantalla.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockedApi.get).toHaveBeenCalledTimes(2)

    expect(screen.getByRole('button', { name: /pagar suscripción/i })).toBeInTheDocument()
    expect(screen.queryByText(/no se pudo verificar el estado/i)).not.toBeInTheDocument()
  })

  it('si el checkout falla muestra el mensaje del servidor y no redirige', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })
    mockedApi.post.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: /pagar suscripción/i }))

    expect(await screen.findByText(/no se pudo iniciar el pago/i)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('tras volver de Flow avisa que la confirmación del pago puede tardar', async () => {
    mockedApi.get.mockResolvedValue({ data: buildStatus() })

    renderPage({ afterPayment: true })

    expect(await screen.findByText(/estamos confirmando tu pago/i)).toBeInTheDocument()
  })

  it('tras volver de Flow consulta el pago al backend y muestra la cuenta vigente sin esperar el webhook', async () => {
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })
    mockedApi.post.mockResolvedValue({ data: buildStatus() })

    renderPage({ afterPayment: true })

    expect(await screen.findByText(/vigente hasta el 1 de diciembre de 2026/i)).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/billing/refresh')
  })

  it('si la consulta al volver de Flow falla, sigue mostrando el estado leído y no rompe la pantalla', async () => {
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })
    mockedApi.post.mockRejectedValue(new Error('network'))

    renderPage({ afterPayment: true })

    expect(await screen.findByText(/solo lectura/i)).toBeInTheDocument()
    expect(screen.getByText(/estamos confirmando tu pago/i)).toBeInTheDocument()
  })

  it('fuera del retorno de Flow no consulta el pago', async () => {
    mockedApi.get.mockResolvedValue({ data: buildStatus() })

    renderPage()

    await screen.findByText(/vigente hasta/i)
    expect(mockedApi.post).not.toHaveBeenCalledWith('/billing/refresh')
  })

  it('si no se puede leer el estado ofrece reintentar y no muestra el botón de pago', async () => {
    mockedApi.get.mockRejectedValue(new Error('network'))

    renderPage()

    expect(
      await screen.findByText(/no se pudo verificar el estado de tu suscripción/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pagar/i })).not.toBeInTheDocument()
  })
})

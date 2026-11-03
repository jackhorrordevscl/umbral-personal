import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import SubscriptionBanner from './SubscriptionBanner'
import SubscriptionNavLink from './SubscriptionNavLink'
import api from '../../api/client'
import type { SubscriptionStatus } from '../../hooks/useSubscription'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn() },
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

function renderWith(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SubscriptionBanner (issue #611)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('en gracia avisa hasta cuándo renovar y enlaza a la pantalla de suscripción', async () => {
    mockedApi.get.mockResolvedValue({
      data: buildStatus({
        state: 'GRACE',
        periodEnd: '2026-11-01T15:00:00.000Z',
        graceEnd: '2026-11-08T15:00:00.000Z',
      }),
    })

    renderWith(<SubscriptionBanner />)

    expect(await screen.findByText(/hasta el 8 de noviembre de 2026/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /renovar/i })).toHaveAttribute('href', '/suscripcion')
  })

  it('en solo lectura avisa que no se pueden registrar cambios y enlaza a renovar', async () => {
    mockedApi.get.mockResolvedValue({
      data: buildStatus({ state: 'READ_ONLY', periodEnd: null }),
    })

    renderWith(<SubscriptionBanner />)

    expect(await screen.findByText(/solo lectura/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /renovar/i })).toHaveAttribute('href', '/suscripcion')
  })

  it.each([
    ['cuenta vigente', buildStatus()],
    ['cuenta exenta', buildStatus({ state: 'EXEMPT', periodEnd: null })],
    ['interruptor apagado', buildStatus({ enforced: false, state: 'READ_ONLY' })],
  ])('no muestra nada con %s', async (_label, status) => {
    mockedApi.get.mockResolvedValue({ data: status })

    const { container } = renderWith(<SubscriptionBanner />)
    await vi.waitFor(() => expect(mockedApi.get).toHaveBeenCalled())

    expect(container).toBeEmptyDOMElement()
  })

  it('no muestra nada si no se pudo leer el estado (no bloquea la app)', async () => {
    mockedApi.get.mockRejectedValue(new Error('network'))

    const { container } = renderWith(<SubscriptionBanner />)
    await vi.waitFor(() => expect(mockedApi.get).toHaveBeenCalled())

    expect(container).toBeEmptyDOMElement()
  })
})

describe('SubscriptionNavLink (issue #611)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aparece en el menú cuando las suscripciones están encendidas', async () => {
    mockedApi.get.mockResolvedValue({ data: buildStatus() })

    renderWith(<SubscriptionNavLink onClick={vi.fn()} />)

    expect(await screen.findByRole('link', { name: /suscripción/i })).toHaveAttribute(
      'href',
      '/suscripcion',
    )
  })

  it('no aparece mientras el interruptor está apagado', async () => {
    mockedApi.get.mockResolvedValue({ data: buildStatus({ enforced: false }) })

    const { container } = renderWith(<SubscriptionNavLink onClick={vi.fn()} />)
    await vi.waitFor(() => expect(mockedApi.get).toHaveBeenCalled())

    expect(container).toBeEmptyDOMElement()
  })
})

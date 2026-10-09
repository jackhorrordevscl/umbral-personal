import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PaymentReturnPage from './PaymentReturnPage'
import api from '../api/client'

// Issue #424: la pantalla consulta el estado real del cobro (solo lectura;
// el webhook sigue siendo la única fuente de confirmación). Estados: pagado,
// procesando (también sin token, cargando o ante error) y rechazado.

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderPage(url: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <PaymentReturnPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaymentReturnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('consulta el estado con el token de la URL', async () => {
    mockedApi.get.mockResolvedValue({ data: { status: 'PAID' } })

    renderPage('/pago-recibido?token=abc')

    await screen.findByText(/Pago recibido/)
    expect(mockedApi.get).toHaveBeenCalledWith('/payments/return-status', {
      params: { token: 'abc' },
    })
  })

  it('muestra la confirmación cuando el pago está PAID', async () => {
    mockedApi.get.mockResolvedValue({ data: { status: 'PAID' } })

    renderPage('/pago-recibido?token=abc')

    expect(await screen.findByText(/Pago recibido/)).toBeInTheDocument()
    expect(screen.queryByText(/siendo procesado/)).not.toBeInTheDocument()
  })

  it('muestra el mensaje de procesando cuando el estado es PENDING', async () => {
    mockedApi.get.mockResolvedValue({ data: { status: 'PENDING' } })

    renderPage('/pago-recibido?token=abc')

    expect(await screen.findByText(/Tu pago está siendo procesado/)).toBeInTheDocument()
    expect(screen.queryByText(/No pudimos completar/)).not.toBeInTheDocument()
  })

  it('muestra el mensaje de procesando mientras carga', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}))

    renderPage('/pago-recibido?token=abc')

    expect(screen.getByText(/Tu pago está siendo procesado/)).toBeInTheDocument()
  })

  it('muestra el mensaje de rechazo y pide un nuevo link sin sugerir reintentar el mismo', async () => {
    mockedApi.get.mockResolvedValue({ data: { status: 'REJECTED' } })

    renderPage('/pago-recibido?token=abc')

    expect(
      await screen.findByText(
        /No pudimos completar tu pago\. Pide a tu terapeuta que te envíe un nuevo link de pago\./,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/intenta de nuevo|reintent/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/siendo procesado/)).not.toBeInTheDocument()
  })

  it('sin token muestra procesando y no llama a la API', () => {
    renderPage('/pago-recibido')

    expect(screen.getByText(/Tu pago está siendo procesado/)).toBeInTheDocument()
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('ante un error de la API sigue mostrando procesando', async () => {
    mockedApi.get.mockRejectedValue(new Error('network'))

    renderPage('/pago-recibido?token=abc')

    await vi.waitFor(() => expect(mockedApi.get).toHaveBeenCalled())
    expect(screen.getByText(/Tu pago está siendo procesado/)).toBeInTheDocument()
    expect(screen.queryByText(/No pudimos completar/)).not.toBeInTheDocument()
  })

  it.each(['?status=rejected', '?error=1'])(
    'ignora parámetros de la URL que no sean el token (%s)',
    (query) => {
      renderPage(`/pago-recibido${query}`)

      expect(screen.getByText(/Tu pago está siendo procesado/)).toBeInTheDocument()
      expect(mockedApi.get).not.toHaveBeenCalled()
    },
  )
})

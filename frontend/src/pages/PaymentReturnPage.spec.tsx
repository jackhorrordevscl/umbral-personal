import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import PaymentReturnPage from './PaymentReturnPage'
import api from '../api/client'

// The page is deliberately static: the real charge state is confirmed only by
// the server-to-server webhook. These tests pin that contract so nobody adds
// client-side "confirmed"/"rejected" states driven by the redirect URL.

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PaymentReturnPage />
    </MemoryRouter>,
  )
}

describe('PaymentReturnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the processing message', () => {
    renderPage('/pago-recibido')

    expect(screen.getByText('¡Gracias!')).toBeInTheDocument()
    expect(screen.getByText(/Tu pago está siendo procesado/)).toBeInTheDocument()
  })

  it('makes no API calls', () => {
    renderPage('/pago-recibido?token=abc')

    expect(mockedApi.get).not.toHaveBeenCalled()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it.each(['?status=success', '?status=rejected', '?error=1', '?token=abc'])(
    'renders the same message regardless of URL params (%s)',
    (query) => {
      renderPage(`/pago-recibido${query}`)

      expect(screen.getByText(/Tu pago está siendo procesado/)).toBeInTheDocument()
      expect(screen.queryByText(/rechazado|error|falló/i)).not.toBeInTheDocument()
    },
  )
})

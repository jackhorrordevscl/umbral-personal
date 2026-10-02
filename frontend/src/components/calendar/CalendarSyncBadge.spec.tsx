import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CalendarSyncBadge from './CalendarSyncBadge'
import api from '../../api/client'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderBadge() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CalendarSyncBadge />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CalendarSyncBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mientras carga no dice "sin configurar"', async () => {
    mockedApi.get.mockImplementation(() => new Promise(() => {}))

    renderBadge()

    expect(await screen.findByText('Verificando Google Calendar...')).toBeInTheDocument()
    expect(screen.queryByText('Google Calendar sin configurar')).not.toBeInTheDocument()
  })

  it('si falla muestra "no disponible" y no "sin configurar"', async () => {
    mockedApi.get.mockRejectedValue(new Error('boom'))

    renderBadge()

    expect(
      await screen.findByText('Estado de Google Calendar no disponible'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Google Calendar sin configurar')).not.toBeInTheDocument()
  })

  it('con estado PENDING real muestra "sin configurar"', async () => {
    mockedApi.get.mockResolvedValue({ data: { status: 'PENDING' } })

    renderBadge()

    expect(await screen.findByText('Google Calendar sin configurar')).toBeInTheDocument()
  })
})

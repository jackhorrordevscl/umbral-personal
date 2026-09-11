import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BlockoutEditor from './BlockoutEditor'
import api from '../../api/client'

// sdd/patient-self-scheduling PR 4 (tasks.md 4.2/4.4, therapist-availability
// Req: Availability Blockouts): editor de bloqueos (día completo / horario
// parcial / rango de fechas), wireado a GET/POST /availability/blockouts y
// DELETE /availability/blockouts/:id.

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

interface BlockoutFixture {
  id: string
  startsAt: string
  endsAt: string
  kind: string
  reason: string | null
}

let blockoutsFixture: BlockoutFixture[]

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BlockoutEditor />
    </QueryClientProvider>,
  )
}

describe('BlockoutEditor — therapist-availability Req: Availability Blockouts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    blockoutsFixture = []
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/availability/blockouts') {
        return Promise.resolve({ data: blockoutsFixture })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    mockedApi.post.mockImplementation((url: string, body?: unknown) => {
      if (url === '/availability/blockouts') {
        const created: BlockoutFixture = {
          id: 'blockout-1',
          reason: null,
          ...(body as Omit<BlockoutFixture, 'id' | 'reason'>),
        }
        blockoutsFixture = [...blockoutsFixture, created]
        return Promise.resolve({ data: created })
      }
      return Promise.reject(new Error(`POST inesperado: ${url}`))
    })
    mockedApi.delete.mockImplementation((url: string) => {
      const id = url.split('/').pop()
      blockoutsFixture = blockoutsFixture.filter((b) => b.id !== id)
      return Promise.resolve({ data: undefined })
    })
  })

  it('agrega un bloqueo de día completo y lo muestra en la lista', async () => {
    const user = userEvent.setup()
    renderEditor()

    await screen.findByText('Sin bloqueos registrados.')

    await user.type(screen.getByLabelText('Fecha'), '2026-06-01')
    await user.click(screen.getByRole('button', { name: 'Agregar bloqueo' }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/availability/blockouts',
        expect.objectContaining({ kind: 'FULL_DAY' }),
      ),
    )

    const list = await screen.findByRole('list')
    expect(within(list).getByText(/Día completo/)).toBeInTheDocument()
  })

  it('quita un bloqueo existente de la lista', async () => {
    blockoutsFixture = [
      {
        id: 'blockout-9',
        startsAt: '2026-06-01T00:00:00-04:00',
        endsAt: '2026-06-02T00:00:00-04:00',
        kind: 'FULL_DAY',
        reason: null,
      },
    ]
    const user = userEvent.setup()
    renderEditor()

    await screen.findByRole('list')
    expect(
      screen.getByRole('button', { name: 'Quitar bloqueo blockout-9' }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Quitar bloqueo blockout-9' }),
    )

    await waitFor(() =>
      expect(mockedApi.delete).toHaveBeenCalledWith(
        '/availability/blockouts/blockout-9',
      ),
    )
    expect(
      await screen.findByText('Sin bloqueos registrados.'),
    ).toBeInTheDocument()
  })
})

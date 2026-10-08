import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AssentSection from './AssentSection'
import api from '../../api/client'
import type { PatientAssent } from '../../types/patient'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildAssent(overrides: Partial<PatientAssent> = {}): PatientAssent {
  return {
    id: 'a1',
    patientId: 'p1',
    ageBand: 'AGE_14_17',
    action: 'GRANTED',
    note: null,
    documentId: null,
    recordedAt: '2026-10-01T15:00:00.000Z',
    recordedBy: { id: 'u1', name: 'Dra. Soto', role: 'THERAPIST' },
    ...overrides,
  }
}

function renderSection(ageBand: 'UNDER_14' | 'AGE_14_17' = 'AGE_14_17') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <AssentSection patientId="p1" ageBand={ageBand} />
    </QueryClientProvider>,
  )
}

function mockAssents(list: PatientAssent[]) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/patients/p1/assents') return Promise.resolve({ data: list })
    return Promise.resolve({ data: [] })
  })
}

describe('AssentSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista el ledger con acción, autor y nota', async () => {
    mockAssents([buildAssent({ note: 'Lo conversó con calma' })])
    renderSection()

    expect(await screen.findByText(/Dra\. Soto/)).toBeInTheDocument()
    expect(screen.getByText('Asentimiento otorgado', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('"Lo conversó con calma"')).toBeInTheDocument()
  })

  it('indica lo que corresponde según el tramo etario', async () => {
    mockAssents([])
    renderSection('UNDER_14')

    expect(await screen.findByText('Sin registros de asentimiento.')).toBeInTheDocument()
    expect(screen.getByText(/informado y oído/i, { selector: 'p' })).toBeInTheDocument()
  })

  it('registra una acción con nota opcional', async () => {
    const user = userEvent.setup()
    mockAssents([])
    mockedApi.post.mockResolvedValue({ data: buildAssent() })
    renderSection()

    await screen.findByText('Sin registros de asentimiento.')
    await user.selectOptions(screen.getByLabelText('Registro'), 'GRANTED')
    await user.type(screen.getByLabelText(/nota/i), '  Asiente  ')
    await user.click(screen.getByRole('button', { name: /registrar asentimiento/i }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/patients/p1/assents', {
        action: 'GRANTED',
        note: 'Asiente',
      }),
    )
  })

  it('sin nota no envía el campo note', async () => {
    const user = userEvent.setup()
    mockAssents([])
    mockedApi.post.mockResolvedValue({ data: buildAssent() })
    renderSection()

    await screen.findByText('Sin registros de asentimiento.')
    await user.click(screen.getByRole('button', { name: /registrar asentimiento/i }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/patients/p1/assents', {
        action: 'INFORMED_AND_HEARD',
      }),
    )
  })

  it('un rechazo como último registro avisa al terapeuta sin bloquear', async () => {
    mockAssents([buildAssent({ action: 'REFUSED' })])
    renderSection()

    expect(await screen.findByRole('alert')).toHaveTextContent(/rechazó el tratamiento/i)
    expect(screen.getByRole('button', { name: /registrar asentimiento/i })).toBeEnabled()
  })

  it('elegir "rechazado" en el formulario muestra el aviso previo', async () => {
    const user = userEvent.setup()
    mockAssents([])
    renderSection()

    await screen.findByText('Sin registros de asentimiento.')
    await user.selectOptions(screen.getByLabelText('Registro'), 'REFUSED')

    expect(screen.getByText(/no impide continuar/i)).toBeInTheDocument()
  })

  it('muestra el error del servidor al registrar', async () => {
    const user = userEvent.setup()
    mockAssents([])
    mockedApi.post.mockRejectedValue(
      Object.assign(new Error('bad'), {
        isAxiosError: true,
        response: { status: 400, data: { message: 'El paciente no es menor de edad' } },
      }),
    )
    renderSection()

    await screen.findByText('Sin registros de asentimiento.')
    await user.click(screen.getByRole('button', { name: /registrar asentimiento/i }))

    expect(await screen.findByText('El paciente no es menor de edad')).toBeInTheDocument()
  })
})

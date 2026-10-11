import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DischargeSection from './DischargeSection'
import api from '../../api/client'
import type { TreatmentDischarge } from '../../types/discharge'
import type { TreatmentStatus } from '../../types/patient'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function build(overrides: Partial<TreatmentDischarge>): TreatmentDischarge {
  return {
    id: 'd1',
    patientId: 'p1',
    groupId: 'd1',
    version: 1,
    correctsId: null,
    source: 'GENERATED',
    status: 'ISSUED',
    closureReason: 'DISCHARGED',
    dropoutReason: null,
    dropoutNote: null,
    referralDestination: null,
    admissionDate: '2026-01-10T00:00:00.000Z',
    dischargeDate: '2026-10-10T00:00:00.000Z',
    sessionCount: 12,
    consultReason: '',
    diagnosis: null,
    evolutionSummary: '',
    statusAtDischarge: '',
    recommendations: '',
    issuedAt: '2026-10-10T15:00:00.000Z',
    contentHash: 'h',
    documentId: 'doc1',
    pdfSha256: 's',
    ...overrides,
  }
}

function renderSection(list: TreatmentDischarge[], status: TreatmentStatus) {
  mockedApi.get.mockResolvedValue({ data: list })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <DischargeSection patientId="p1" treatmentStatus={status} />
    </QueryClientProvider>,
  )
}

describe('DischargeSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('un paciente en tratamiento sin informes ofrece "Dar de alta"', async () => {
    renderSection([], 'ACTIVE')
    expect(await screen.findByText('Sin informes de alta.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Dar de alta/ })).toBeInTheDocument()
  })

  it('con el tratamiento cerrado lista versiones y solo permite corregir la vigente', async () => {
    const v1 = build({ id: 'd1', version: 1 })
    const v2 = build({ id: 'd2', version: 2, correctsId: 'd1', source: 'UPLOADED' })
    renderSection([v1, v2], 'DISCHARGED')

    expect(await screen.findByText(/Versión 2/)).toBeInTheDocument()
    expect(screen.getByText(/Versión 1/)).toBeInTheDocument()
    expect(screen.getByText(/PDF propio del terapeuta/)).toBeInTheDocument()
    expect(screen.getByText('Reemplazada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dar de alta/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Corregir' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Descargar el PDF de la versión 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verificar la versión 2' })).toBeInTheDocument()
  })
})

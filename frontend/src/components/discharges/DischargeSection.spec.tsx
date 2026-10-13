import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('./DischargeForm', () => ({
  default: ({ onDone }: { onDone: (r: { cancelledConsultations: number }) => void }) => (
    <button type="button" onClick={() => onDone({ cancelledConsultations: 2 })}>
      Terminar alta simulada
    </button>
  ),
}))

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

  it('muestra la fecha de cierre sin desfase de zona horaria (issue #444)', async () => {
    renderSection(
      [build({ admissionDate: '2026-01-10T00:00:00.000Z', dischargeDate: '2026-10-12T00:00:00.000Z' })],
      'DISCHARGED',
    )
    expect(await screen.findByText(/Fecha de cierre: 12-10-2026/)).toBeInTheDocument()
  })

  it('con dos grupos ordena las versiones por fecha de creación descendente (issue #444)', async () => {
    const a1 = build({ id: 'a1', groupId: 'a1', version: 1, createdAt: '2026-02-01T10:00:00.000Z' })
    const a2 = build({ id: 'a2', groupId: 'a1', version: 2, correctsId: 'a1', createdAt: '2026-03-01T10:00:00.000Z' })
    // Tratamiento reabierto y vuelto a cerrar: grupo nuevo, versión 1.
    const b1 = build({ id: 'b1', groupId: 'b1', version: 1, createdAt: '2026-09-01T10:00:00.000Z' })
    renderSection([a2, b1, a1], 'DISCHARGED')

    await screen.findByText(/Versión 2/)
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => /Versión (\d)/.exec(li.textContent ?? '')?.[1])).toEqual(['1', '2', '1'])
    expect(within(items[0]).getByRole('button', { name: 'Descargar el PDF de la versión 1' })).toBeInTheDocument()
    expect(items[0].textContent).not.toContain('Reemplazada')
    expect(items[1].textContent).not.toContain('Reemplazada')
    expect(items[2].textContent).toContain('Reemplazada')
  })

  it('si falla la carga de la lista no ofrece "Dar de alta" y permite reintentar (issue #444)', async () => {
    mockedApi.get.mockRejectedValue(new Error('boom'))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <DischargeSection patientId="p1" treatmentStatus="ACTIVE" />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('No se pudieron cargar los informes de alta.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dar de alta/ })).not.toBeInTheDocument()
  })

  it('al completar un alta anuncia el resultado en una región role="status" (issue #444)', async () => {
    const user = userEvent.setup()
    renderSection([], 'ACTIVE')
    await user.click(await screen.findByRole('button', { name: /Dar de alta/ }))
    await user.click(screen.getByRole('button', { name: 'Terminar alta simulada' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Informe emitido. Se cancelaron 2 consultas futuras.')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import VerifyDischargeDialog from './VerifyDischargeDialog'
import api from '../../api/client'
import { expectNoA11yViolations } from '../../test/axe'
import type { DischargeVerification } from '../../types/discharge'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn() },
}))

const mockedApi = vi.mocked(api)

const base: DischargeVerification = {
  valid: true,
  dischargeId: 'd1',
  groupId: 'd1',
  version: 2,
  status: 'ISSUED',
  issuedAt: '2026-10-10T15:00:00.000Z',
  contentHash: 'abc123',
  isCurrent: true,
  pdf: { present: true, intact: true },
  source: 'GENERATED',
  providedByTherapist: false,
  hashScope: 'CONTENT',
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <VerifyDischargeDialog dischargeId="d1" onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('VerifyDischargeDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('un PDF aportado por el terapeuta nunca se presenta como firmado por el sistema', async () => {
    mockedApi.get.mockResolvedValue({
      data: { ...base, source: 'UPLOADED', providedByTherapist: true, hashScope: 'FILE_ONLY' },
    })
    const { baseElement } = renderDialog()

    expect(await screen.findByText(/Documento aportado por el terapeuta/)).toBeInTheDocument()
    expect(screen.getByText(/no lo firma ni certifica/)).toBeInTheDocument()
    // Issue #492: la huella cubre solo el archivo; los datos del cierre quedan fuera.
    expect(screen.getByText(/La huella cubre solo el archivo/)).toBeInTheDocument()
    expect(screen.queryByText(/firmado por el sistema/i)).not.toBeInTheDocument()
    expect(screen.getByText(/El PDF guardado coincide/)).toBeInTheDocument()
    await expectNoA11yViolations(baseElement)
  })

  it('un informe generado indica su origen y la vigencia', async () => {
    mockedApi.get.mockResolvedValue({ data: base })
    renderDialog()

    expect(await screen.findByText(/Informe generado por el sistema/)).toBeInTheDocument()
    expect(screen.queryByText(/Documento aportado por el terapeuta/)).not.toBeInTheDocument()
    expect(screen.queryByText(/La huella cubre solo el archivo/)).not.toBeInTheDocument()
    expect(screen.getByText(/2 \(vigente\)/)).toBeInTheDocument()
  })

  it('avisa cuando el PDF guardado fue alterado', async () => {
    mockedApi.get.mockResolvedValue({ data: { ...base, pdf: { present: true, intact: false } } })
    renderDialog()

    expect(await screen.findByText(/El PDF guardado no coincide/)).toBeInTheDocument()
  })

  it('anuncia la carga y el resultado como avisos de estado (issue #444)', async () => {
    mockedApi.get.mockResolvedValue({ data: base })
    renderDialog()

    expect(screen.getByRole('status')).toHaveTextContent('Verificando...')
    await screen.findByText(/Informe generado por el sistema/)
    expect(screen.getByRole('status')).toHaveTextContent(/coincide con su huella digital/)
  })
})

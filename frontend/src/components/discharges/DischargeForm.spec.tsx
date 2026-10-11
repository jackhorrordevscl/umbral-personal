import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DischargeForm from './DischargeForm'
import api from '../../api/client'
import { expectNoA11yViolations } from '../../test/axe'
import type { TreatmentDischarge } from '../../types/discharge'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockedApi = vi.mocked(api)

const PREVIEW_URL = '/patients/p1/discharges/cancellation-preview'

function mockGet(options: { count?: number; rut?: string | null } = {}) {
  const { count = 0, rut = '12345678-5' } = options
  mockedApi.get.mockImplementation((url: string) => {
    if (url === PREVIEW_URL) {
      return Promise.resolve({
        data: {
          count,
          consultations: Array.from({ length: count }, (_, i) => ({
            id: `c${i}`,
            groupId: `g${i}`,
            sessionDate: '2026-11-03T13:00:00.000Z',
          })),
        },
      })
    }
    if (url === '/profile') return Promise.resolve({ data: { id: 'u1', rut } })
    return Promise.resolve({ data: [] })
  })
}

const draft: TreatmentDischarge = {
  id: 'd1',
  patientId: 'p1',
  groupId: 'd1',
  version: 1,
  correctsId: null,
  source: 'GENERATED',
  status: 'DRAFT',
  closureReason: 'DISCHARGED',
  dropoutReason: null,
  dropoutNote: null,
  referralDestination: null,
  admissionDate: '2026-01-10T00:00:00.000Z',
  dischargeDate: '2026-10-10T00:00:00.000Z',
  sessionCount: 12,
  consultReason: 'Ansiedad',
  diagnosis: null,
  evolutionSummary: '',
  statusAtDischarge: '',
  recommendations: '',
  issuedAt: null,
  contentHash: null,
  documentId: null,
  pdfSha256: null,
}

function renderForm(props: Partial<React.ComponentProps<typeof DischargeForm>> = {}) {
  const onDone = vi.fn()
  const onClose = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DischargeForm patientId="p1" onClose={onClose} onDone={onDone} {...props} />
    </QueryClientProvider>,
  )
  return { onDone, onClose, ...view }
}

async function chooseUploadAndPick(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Subir mi propio PDF/ }))
  const file = new File(['%PDF-1.4'], 'alta.pdf', { type: 'application/pdf' })
  await user.upload(screen.getByLabelText(/Archivo PDF del informe/), file)
  return file
}

describe('DischargeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet()
  })

  it('ofrece los dos caminos y no tiene violaciones de accesibilidad', async () => {
    const { baseElement } = renderForm()
    expect(screen.getByRole('button', { name: 'Generar con el sistema' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Subir mi propio PDF/ })).toBeInTheDocument()
    await expectNoA11yViolations(baseElement)
  })

  it('subir PDF con consultas futuras pide confirmar antes de enviar', async () => {
    mockGet({ count: 2 })
    mockedApi.post.mockResolvedValue({ data: { ...draft, status: 'ISSUED', cancelledConsultations: 2 } })
    const user = userEvent.setup()
    const { onDone } = renderForm()
    const file = await chooseUploadAndPick(user)

    await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

    const dialog = await screen.findByRole('dialog', { name: 'Se cancelarán consultas futuras' })
    expect(within(dialog).getByText(/2 consultas futuras/)).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [url, body] = mockedApi.post.mock.calls[0]
    expect(url).toBe('/patients/p1/discharges/upload')
    expect((body as FormData).get('file')).toBe(file)
    expect((body as FormData).get('closureReason')).toBe('DISCHARGED')
  })

  it('cancelar la confirmación no envía nada', async () => {
    mockGet({ count: 1 })
    const user = userEvent.setup()
    renderForm()
    await chooseUploadAndPick(user)
    await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

    const dialog = await screen.findByRole('dialog', { name: 'Se cancelarán consultas futuras' })
    expect(within(dialog).getByText(/1 consulta futura/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('sin consultas por cancelar envía directo', async () => {
    mockedApi.post.mockResolvedValue({ data: { ...draft, cancelledConsultations: 0 } })
    const user = userEvent.setup()
    const { onDone } = renderForm()
    await chooseUploadAndPick(user)
    await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(screen.queryByText('Se cancelarán consultas futuras')).not.toBeInTheDocument()
  })

  it('un 413 del servidor muestra el mensaje del tamaño máximo', async () => {
    mockedApi.post.mockRejectedValue(
      Object.assign(new Error('too big'), { isAxiosError: true, response: { status: 413, data: {} } }),
    )
    const user = userEvent.setup()
    renderForm()
    await chooseUploadAndPick(user)
    await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

    expect(
      await screen.findByText('El archivo supera el tamaño máximo permitido (25 MB).'),
    ).toBeInTheDocument()
  })

  it('exige el motivo de deserción antes de subir', async () => {
    const user = userEvent.setup()
    renderForm()
    await chooseUploadAndPick(user)
    await user.selectOptions(screen.getByLabelText(/Motivo del cierre/), 'DROPPED_OUT')

    await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

    expect(
      await screen.findByText('Selecciona el motivo principal de la deserción'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('con motivo Otro pide un detalle breve y muestra el aviso de datos sensibles', async () => {
    const user = userEvent.setup()
    renderForm()
    await chooseUploadAndPick(user)
    await user.selectOptions(screen.getByLabelText(/Motivo del cierre/), 'DROPPED_OUT')
    await user.selectOptions(screen.getByLabelText(/Motivo principal de la deserción/), 'OTHER')

    expect(screen.getByText(/No incluir datos sensibles/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))
    expect(await screen.findByText('Indica un detalle breve del motivo')).toBeInTheDocument()
  })

  it('con el RUT del perfil vacío avisa y bloquea la emisión del informe generado', async () => {
    mockGet({ rut: null })
    renderForm({ draft })

    const link = await screen.findByRole('link', { name: /Completar mi RUT/ })
    expect(link).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('button', { name: 'Emitir informe' })).toBeDisabled()
  })

  it('emite el informe generado: confirma cancelaciones, guarda y emite', async () => {
    mockGet({ count: 1 })
    mockedApi.patch.mockResolvedValue({ data: draft })
    mockedApi.post.mockResolvedValue({ data: { ...draft, status: 'ISSUED', cancelledConsultations: 1 } })
    const user = userEvent.setup()
    const { onDone } = renderForm({ draft })

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/profile'))
    await user.click(screen.getByRole('button', { name: 'Emitir informe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Se cancelarán consultas futuras' })
    expect(mockedApi.patch).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/discharges/d1',
      expect.objectContaining({ admissionDate: '2026-01-10', sessionCount: 12, diagnosis: null }),
    )
    expect(mockedApi.post).toHaveBeenCalledWith('/discharges/d1/issue')
  })
})

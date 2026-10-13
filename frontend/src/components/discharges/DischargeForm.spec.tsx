import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DischargeForm from './DischargeForm'
import Modal from '../ui/Modal'
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

const completeDraft: TreatmentDischarge = {
  ...draft,
  evolutionSummary: 'Buena evolución',
  statusAtDischarge: 'Estable',
  recommendations: 'Seguimiento anual',
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

  it('los botones del paso de subida tienen tamaño táctil mínimo en móvil (issue #444)', async () => {
    mockGet()
    const user = userEvent.setup()
    renderForm()
    await chooseUploadAndPick(user)

    for (const name of ['Subir y cerrar tratamiento', 'Volver']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11')
    }
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
    const { onDone } = renderForm({ draft: completeDraft })

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

  describe('validación previa y copys (issue #444)', () => {
    it('con campos obligatorios vacíos avisa antes de pedir la confirmación destructiva', async () => {
      mockGet({ count: 2 })
      const user = userEvent.setup()
      renderForm({ draft })

      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('/profile'))
      await user.click(screen.getByRole('button', { name: 'Emitir informe' }))

      expect(
        await screen.findByText(/Completa antes de emitir: resumen de la evolución, estado al cierre, recomendaciones./),
      ).toBeInTheDocument()
      expect(screen.queryByRole('dialog', { name: 'Se cancelarán consultas futuras' })).not.toBeInTheDocument()
      expect(mockedApi.get).not.toHaveBeenCalledWith(PREVIEW_URL)
    })

    it('marca con asterisco los textos obligatorios y no el diagnóstico', () => {
      renderForm({ draft })
      for (const label of ['Motivo de consulta', 'Resumen de la evolución', 'Estado al cierre', 'Recomendaciones']) {
        expect(screen.getByText(label + ' *')).toBeInTheDocument()
      }
      expect(screen.getByText('Diagnóstico (opcional)')).toBeInTheDocument()
    })

    it('un archivo que no es PDF se rechaza antes de la confirmación', async () => {
      mockGet({ count: 1 })
      const user = userEvent.setup()
      renderForm()
      await user.click(screen.getByRole('button', { name: /Subir mi propio PDF/ }))
      fireEvent.change(screen.getByLabelText(/Archivo PDF del informe/), {
        target: { files: [new File(['x'], 'alta.txt', { type: 'text/plain' })] },
      })
      await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

      expect(await screen.findByText('Solo se permite subir un archivo PDF.')).toBeInTheDocument()
      expect(screen.queryByRole('dialog', { name: 'Se cancelarán consultas futuras' })).not.toBeInTheDocument()
      expect(mockedApi.get).not.toHaveBeenCalledWith(PREVIEW_URL)
    })

    it('un archivo de más de 25 MB se rechaza antes de la confirmación', async () => {
      mockGet({ count: 1 })
      const user = userEvent.setup()
      renderForm()
      await user.click(screen.getByRole('button', { name: /Subir mi propio PDF/ }))
      const big = new File(['x'], 'alta.pdf', { type: 'application/pdf' })
      Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 })
      fireEvent.change(screen.getByLabelText(/Archivo PDF del informe/), { target: { files: [big] } })
      await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

      expect(
        await screen.findByText('El archivo supera el tamaño máximo permitido (25 MB).'),
      ).toBeInTheDocument()
      expect(mockedApi.get).not.toHaveBeenCalledWith(PREVIEW_URL)
    })

    it('la fecha de cierre por defecto es el día de Chile, no el del navegador', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        // 23:00 del 11 de octubre en Chile; ya es 12 en UTC.
        vi.setSystemTime(new Date('2026-10-12T02:00:00.000Z'))
        const user = userEvent.setup()
        renderForm()
        await user.click(screen.getByRole('button', { name: /Subir mi propio PDF/ }))
        expect(screen.getByLabelText(/Fecha de cierre/)).toHaveValue('2026-10-11')
      } finally {
        vi.useRealTimers()
      }
    })

    it('rechaza una fecha de cierre futura sin pedir confirmación', async () => {
      mockGet({ count: 1 })
      const user = userEvent.setup()
      renderForm()
      await chooseUploadAndPick(user)
      fireEvent.change(screen.getByLabelText(/Fecha de cierre/), { target: { value: '2999-01-01' } })
      await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

      expect(await screen.findByText('La fecha de alta no puede ser futura.')).toBeInTheDocument()
      expect(mockedApi.get).not.toHaveBeenCalledWith(PREVIEW_URL)
    })

    it('la vista previa de cancelación no muestra segundos', async () => {
      mockGet({ count: 1 })
      const user = userEvent.setup()
      renderForm()
      await chooseUploadAndPick(user)
      await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

      const dialog = await screen.findByRole('dialog', { name: 'Se cancelarán consultas futuras' })
      expect(dialog.textContent).toContain('10:00')
      expect(dialog.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/)
    })

    it('el texto del borrador dice solo lo que se prellena: fechas y número de sesiones', async () => {
      const user = userEvent.setup()
      renderForm()
      await user.click(screen.getByRole('button', { name: /Generar con el sistema/ }))

      expect(
        await screen.findByText(/prellena con las fechas y el número de sesiones/),
      ).toBeInTheDocument()
      expect(screen.queryByText(/datos de las consultas/)).not.toBeInTheDocument()
    })

    it('el error de validación se muestra con role="alert" y se lleva a la vista', async () => {
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const user = userEvent.setup()
      renderForm()
      await user.click(screen.getByRole('button', { name: /Subir mi propio PDF/ }))
      await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona el archivo PDF')
      expect(scrollIntoView).toHaveBeenCalled()
    })
  })

  describe('cierre del modal (issue #444)', () => {
    it('Escape en el formulario o en la confirmación no cierra el modal padre', async () => {
      mockGet({ count: 1 })
      const onCloseParent = vi.fn()
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <QueryClientProvider client={new QueryClient()}>
          <Modal onClose={onCloseParent} labelledBy="parent-title">
            <h3 id="parent-title">Paciente</h3>
            <DischargeForm patientId="p1" onClose={onClose} onDone={vi.fn()} />
          </Modal>
        </QueryClientProvider>,
      )
      await chooseUploadAndPick(user)
      await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))
      const confirm = await screen.findByRole('dialog', { name: 'Se cancelarán consultas futuras' })

      fireEvent.keyDown(within(confirm).getByRole('button', { name: 'Cancelar' }), { key: 'Escape' })
      expect(screen.queryByRole('dialog', { name: 'Se cancelarán consultas futuras' })).not.toBeInTheDocument()
      expect(onCloseParent).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()

      fireEvent.keyDown(screen.getByLabelText(/Archivo PDF del informe/), { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onCloseParent).not.toHaveBeenCalled()
    })

    it('no se puede cerrar mientras sube el archivo', async () => {
      let resolveUpload: (value: unknown) => void = () => {}
      mockedApi.post.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve }))
      const user = userEvent.setup()
      const { onClose, onDone } = renderForm()
      await chooseUploadAndPick(user)
      await user.click(screen.getByRole('button', { name: 'Subir y cerrar tratamiento' }))
      await screen.findByRole('button', { name: 'Subiendo...' })

      fireEvent.keyDown(screen.getByLabelText(/Archivo PDF del informe/), { key: 'Escape' })
      expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Cerrar' }))
      expect(onClose).not.toHaveBeenCalled()

      resolveUpload({ data: { ...draft, cancelledConsultations: 0 } })
      await waitFor(() => expect(onDone).toHaveBeenCalled())
    })
  })
})

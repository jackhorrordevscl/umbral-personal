import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PatientModal from './PatientModal'
import api from '../../api/client'
import type { LegalGuardian, Patient, PatientDocument } from '../../types/patient'

// Issue #270: anular documentos legales desde la ficha (sin borrado físico).

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

const patient = {
  id: 'patient-1',
  fullName: 'Paciente Prueba',
  rut: '11111111-1',
  consents: { TREATMENT: true, TELEMEDICINE: false },
} as unknown as Patient

const activeDoc: PatientDocument = {
  id: 'doc-1',
  fileName: 'consentimiento.pdf',
  type: 'INFORMED_CONSENT',
  uploadedAt: '2026-09-01T10:00:00.000Z',
}

const voidedDoc: PatientDocument = {
  id: 'doc-2',
  fileName: 'duplicado.pdf',
  type: 'INFORMED_CONSENT',
  uploadedAt: '2026-09-02T10:00:00.000Z',
  voidedAt: '2026-09-03T10:00:00.000Z',
  voidedById: 'user-1',
  voidReason: 'Archivo duplicado',
}

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientModal patient={patient} initialTab="detail" onClose={() => undefined} />
    </QueryClientProvider>,
  )
}

describe('PatientModal — anular documentos legales (#270)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/documents/patient/patient-1') {
        return Promise.resolve({ data: [activeDoc, voidedDoc] })
      }
      if (url === '/patients/patient-1/consents/status') {
        return Promise.resolve({ data: { TREATMENT: false, TELEMEDICINE: false } })
      }
      return Promise.resolve({ data: [] })
    })
  })

  it('muestra el badge y el motivo en los anulados y solo ofrece "Anular" en los vigentes', async () => {
    renderModal()

    expect(await screen.findByText('Anulado')).toBeInTheDocument()
    expect(screen.getByText(/Motivo: Archivo duplicado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anular consentimiento.pdf' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anular duplicado.pdf' })).not.toBeInTheDocument()
    // La descarga sigue disponible en ambos (custodia).
    expect(screen.getByRole('button', { name: 'Descargar duplicado.pdf' })).toBeInTheDocument()
  })

  it('si falla la carga de documentos muestra el error y no "Sin documentos subidos." (#294)', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/documents/patient/patient-1') return Promise.reject(new Error('boom'))
      if (url === '/patients/patient-1/consents/status') {
        return Promise.resolve({ data: { TREATMENT: false, TELEMEDICINE: false } })
      }
      return Promise.resolve({ data: [] })
    })

    renderModal()

    expect(await screen.findByText(/No se pudieron cargar los documentos/)).toBeInTheDocument()
    expect(screen.queryByText('Sin documentos subidos.')).not.toBeInTheDocument()
  })

  it('exige un motivo de al menos 5 caracteres antes de llamar a la API', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('button', { name: 'Anular consentimiento.pdf' }))
    await user.type(screen.getByLabelText(/motivo de la anulación/i), 'no')
    await user.click(screen.getByRole('button', { name: 'Anular documento' }))

    expect(screen.getByText(/entre 5 y 500 caracteres/i)).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('envía el motivo, cierra el diálogo y refresca el estado de consentimiento', async () => {
    mockedApi.post.mockResolvedValue({ data: { ...activeDoc, voidedAt: '2026-09-25T00:00:00.000Z' } })
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('button', { name: 'Anular consentimiento.pdf' }))
    await user.type(screen.getByLabelText(/motivo de la anulación/i), '  Archivo equivocado  ')
    await user.click(screen.getByRole('button', { name: 'Anular documento' }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/documents/doc-1/void', {
        reason: 'Archivo equivocado',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Anular documento' })).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith('/patients/patient-1/consents/status'),
    )
    // El estado de la ficha abierta pasa de "✓" a "Pendiente".
    await waitFor(() => expect(screen.getByText(/Presencial: Pendiente/)).toBeInTheDocument())
  })

  it('muestra el error del servidor y deja el diálogo abierto', async () => {
    mockedApi.post.mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'El documento ya está anulado.' } },
    })
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('button', { name: 'Anular consentimiento.pdf' }))
    await user.type(screen.getByLabelText(/motivo de la anulación/i), 'Archivo equivocado')
    await user.click(screen.getByRole('button', { name: 'Anular documento' }))

    expect(await screen.findByText(/No se pudo anular el documento|ya está anulado/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Anular documento' })).toBeInTheDocument()
  })
})

describe('PatientModal — formularios (#295)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients/patient-1') return Promise.resolve({ data: patient })
      if (url === '/documents/patient/patient-1') {
        return Promise.resolve({
          data: [{ ...activeDoc, id: 'doc-3', fileName: 'sesion.pdf', type: 'SESSION_SUMMARY' }],
        })
      }
      return Promise.resolve({ data: [] })
    })
  })

  it('muestra la etiqueta del registro de sesión y no el código crudo', async () => {
    renderModal()

    expect(await screen.findByText('Registro de sesión')).toBeInTheDocument()
    expect(screen.queryByText('SESSION_SUMMARY')).not.toBeInTheDocument()
  })

  it('tras un fallo parcial de consentimiento conserva los datos y el motivo del formulario', async () => {
    mockedApi.patch.mockResolvedValue({ data: {} })
    mockedApi.post.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    await user.click(screen.getByLabelText('Presencial'))
    await user.type(screen.getByLabelText(/motivo de la modificación/i), 'Corrección de datos de contacto')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText(/no se pudo registrar el consentimiento/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre completo')).toHaveValue('Paciente Prueba')
    expect(screen.getByLabelText(/motivo de la modificación/i)).toHaveValue(
      'Corrección de datos de contacto',
    )
  })

  it('hacer clic en la pestaña Editar ya activa no reinicia lo escrito', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    await user.type(screen.getByLabelText('Teléfono'), '999')
    await user.click(screen.getByRole('button', { name: 'Editar' }))

    expect(screen.getByLabelText('Teléfono')).toHaveValue('999')
  })
})

// Bloque Menores (M5)
const guardian: LegalGuardian = {
  id: 'guardian-1',
  patientId: 'patient-1',
  fullName: 'Ana Pérez',
  rut: '12345678-5',
  relationship: 'MOTHER',
  email: null,
  phone: null,
  isPayer: true,
  receivesCommunications: true,
  canAccessReports: true,
  canConsent: true,
  custody: 'SOLE',
  hasConflict: false,
}

const minorPatient = {
  ...patient,
  birthDate: '2015-05-05T00:00:00.000Z',
  isMinor: true,
  ageBand: 'UNDER_14',
  guardianCount: 0,
  minorStatus: 'MISSING_GUARDIAN',
} as unknown as Patient

function renderMinorModal(target: Patient = minorPatient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientModal patient={target} initialTab="detail" onClose={() => undefined} />
    </QueryClientProvider>,
  )
}

function mockMinorApi(guardians: LegalGuardian[]) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/patients/patient-1/guardians') return Promise.resolve({ data: guardians })
    if (url === '/patients/patient-1/assents') return Promise.resolve({ data: [] })
    if (url === '/patients/patient-1') return Promise.resolve({ data: minorPatient })
    return Promise.resolve({ data: [] })
  })
}

function fileInput(container: HTMLElement) {
  return container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
}

describe('PatientModal — pacientes menores (bloque Menores, M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el tramo etario, la alerta con el plazo, los representantes y el asentimiento', async () => {
    mockMinorApi([])
    renderMinorModal()

    expect(screen.getByText('Menor de 14 años')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/01-12-2026/)
    expect(await screen.findByText('Sin representantes registrados.')).toBeInTheDocument()
    expect(screen.getByText('Asentimiento del menor')).toBeInTheDocument()
  })

  it('un adulto no ve alerta, representantes ni asentimiento', () => {
    mockedApi.get.mockResolvedValue({ data: [] })
    renderModal()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Representantes legales')).not.toBeInTheDocument()
    expect(screen.queryByText('Asentimiento del menor')).not.toBeInTheDocument()
  })

  it('sin representante con canConsent bloquea la subida de un consentimiento', async () => {
    mockMinorApi([])
    renderMinorModal()

    expect(await screen.findByText(/agrega primero un representante legal/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /subir/i })).toBeDisabled()
  })

  it('sube el consentimiento de un menor con el guardianId del representante', async () => {
    const user = userEvent.setup()
    mockMinorApi([guardian])
    mockedApi.post.mockResolvedValue({ data: {} })
    const { container } = renderMinorModal()

    await screen.findByLabelText('Representante que otorga el consentimiento')
    await user.upload(fileInput(container), new File(['x'], 'firma.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled())
    const [url, body] = mockedApi.post.mock.calls[0]
    expect(url).toBe('/documents/upload')
    const form = body as FormData
    expect(form.get('type')).toBe('INFORMED_CONSENT')
    expect(form.get('guardianId')).toBe('guardian-1')
  })

  it('el asentimiento informado de un menor se sube sin representante', async () => {
    const user = userEvent.setup()
    mockMinorApi([])
    mockedApi.post.mockResolvedValue({ data: {} })
    const { container } = renderMinorModal()

    await user.selectOptions(
      await screen.findByLabelText('Tipo de documento a subir'),
      'INFORMED_ASSENT',
    )
    await user.upload(
      fileInput(container),
      new File(['x'], 'asentimiento.pdf', { type: 'application/pdf' }),
    )

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled())
    const form = mockedApi.post.mock.calls[0][1] as FormData
    expect(form.get('type')).toBe('INFORMED_ASSENT')
    expect(form.has('guardianId')).toBe(false)
  })

  it('un adulto sube el consentimiento sin guardianId', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValue({ data: [] })
    mockedApi.post.mockResolvedValue({ data: {} })
    const { container } = renderModal()

    await user.upload(fileInput(container), new File(['x'], 'firma.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled())
    expect((mockedApi.post.mock.calls[0][1] as FormData).has('guardianId')).toBe(false)
  })

  it('al otorgar un consentimiento desde la edición envía GUARDIAN y el guardianId', async () => {
    const user = userEvent.setup()
    mockMinorApi([guardian])
    mockedApi.patch.mockResolvedValue({ data: {} })
    mockedApi.post.mockResolvedValue({ data: {} })
    renderMinorModal({
      ...minorPatient,
      consents: { TREATMENT: false, TELEMEDICINE: false },
    } as unknown as Patient)

    await screen.findByRole('button', { name: 'Editar a Ana Pérez' })
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByLabelText('Presencial'))
    await user.type(
      screen.getByLabelText(/motivo de la modificación/i),
      'Regularización del representante',
    )
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/patients/patient-1/consents',
        expect.objectContaining({
          purpose: 'TREATMENT',
          action: 'GRANT',
          grantedBy: 'GUARDIAN',
          guardianId: 'guardian-1',
        }),
      ),
    )
  })

  it('un adulto que otorga consentimiento desde la edición no envía grantedBy', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValue({ data: [] })
    mockedApi.patch.mockResolvedValue({ data: {} })
    mockedApi.post.mockResolvedValue({ data: {} })
    renderModal()

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByLabelText('Telemedicina'))
    await user.type(
      screen.getByLabelText(/motivo de la modificación/i),
      'Consentimiento de telemedicina',
    )
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled())
    const body = mockedApi.post.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('grantedBy')
    expect(body).not.toHaveProperty('guardianId')
  })
})

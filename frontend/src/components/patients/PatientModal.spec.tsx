import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PatientModal from './PatientModal'
import api from '../../api/client'
import type { Patient, PatientDocument } from '../../types/patient'

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

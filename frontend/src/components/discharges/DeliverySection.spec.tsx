import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DeliverySection from './DeliverySection'
import api from '../../api/client'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

const GUARDIANS = [
  { id: 'g1', fullName: 'María Soto', canAccessReports: true },
  { id: 'g2', fullName: 'Pedro Soto', canAccessReports: false },
]

const DOCUMENTS = [
  { id: 'doc1', fileName: 'autorizacion-colegio.pdf', type: 'DELIVERY_AUTHORIZATION', voidedAt: null },
  { id: 'doc2', fileName: 'anulada.pdf', type: 'DELIVERY_AUTHORIZATION', voidedAt: '2026-10-01T00:00:00.000Z' },
  { id: 'doc3', fileName: 'consentimiento.pdf', type: 'INFORMED_CONSENT', voidedAt: null },
]

const DELIVERY = {
  id: 'del1',
  dischargeId: 'dis1',
  recipientType: 'PATIENT',
  recipientName: 'Luis Soto',
  guardianId: null,
  authorizationDocumentId: null,
  purpose: 'Entrega en la última sesión',
  channel: 'IN_PERSON',
  deliveredAt: '2026-10-12T15:00:00.000Z',
}

function setup({
  isMinor = false,
  deliveries = [] as unknown[],
  guardians = GUARDIANS as unknown[],
  documents = DOCUMENTS as unknown[],
} = {}) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/discharges/dis1/deliveries') return Promise.resolve({ data: deliveries })
    if (url === '/patients/p1/guardians') return Promise.resolve({ data: guardians })
    if (url === '/documents/patient/p1') return Promise.resolve({ data: documents })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
  mockedApi.post.mockResolvedValue({ data: { ...DELIVERY } })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <DeliverySection dischargeId="dis1" patientId="p1" isMinor={isMinor} />
    </QueryClientProvider>,
  )
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Registrar entrega/ }))
  return screen.getByRole('dialog')
}

describe('DeliverySection (T4c)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista las entregas registradas', async () => {
    setup({ deliveries: [DELIVERY] })

    expect(await screen.findByText(/Luis Soto/)).toBeInTheDocument()
    expect(screen.getByText(/Paciente/)).toBeInTheDocument()
    expect(screen.getByText(/En persona/)).toBeInTheDocument()
    expect(screen.getByText(/Entrega en la última sesión/)).toBeInTheDocument()
  })

  it('sin entregas muestra un mensaje y ofrece registrar una', async () => {
    setup()

    expect(await screen.findByText('Sin entregas registradas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Registrar entrega/ })).toBeInTheDocument()
  })

  it('a un paciente adulto se le registra la entrega sin pedir datos del destinatario', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = await openDialog(user)

    const types = within(dialog).getByLabelText(/Destinatario/)
    expect(within(types).queryByRole('option', { name: 'Representante legal' })).not.toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/Finalidad/), 'Entrega en la última sesión')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }))

    expect(mockedApi.post).toHaveBeenCalledWith('/discharges/dis1/deliveries', {
      recipientType: 'PATIENT',
      purpose: 'Entrega en la última sesión',
      channel: 'IN_PERSON',
    })
  })

  it('con un paciente menor no se ofrece "Paciente" y solo se listan representantes con acceso a informes', async () => {
    const user = userEvent.setup()
    setup({ isMinor: true })
    const dialog = await openDialog(user)

    const types = within(dialog).getByLabelText(/Destinatario/)
    expect(within(types).queryByRole('option', { name: 'Paciente' })).not.toBeInTheDocument()

    await user.selectOptions(types, 'GUARDIAN')
    const guardian = await within(dialog).findByLabelText(/^Representante/)
    expect(within(guardian).getByRole('option', { name: 'María Soto' })).toBeInTheDocument()
    expect(within(guardian).queryByRole('option', { name: 'Pedro Soto' })).not.toBeInTheDocument()

    await user.selectOptions(guardian, 'g1')
    await user.type(within(dialog).getByLabelText(/Finalidad/), 'Entrega al representante')
    await user.selectOptions(within(dialog).getByLabelText(/Canal/), 'EMAIL')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }))

    expect(mockedApi.post).toHaveBeenCalledWith('/discharges/dis1/deliveries', {
      recipientType: 'GUARDIAN',
      guardianId: 'g1',
      purpose: 'Entrega al representante',
      channel: 'EMAIL',
    })
  })

  it('a un tercero solo se le entrega con una autorización vigente', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByLabelText(/Destinatario/), 'THIRD_PARTY')
    const authorization = await within(dialog).findByLabelText(/^Autorización/)
    expect(within(authorization).getByRole('option', { name: 'autorizacion-colegio.pdf' })).toBeInTheDocument()
    expect(within(authorization).queryByRole('option', { name: 'anulada.pdf' })).not.toBeInTheDocument()
    expect(within(authorization).queryByRole('option', { name: 'consentimiento.pdf' })).not.toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/Nombre del tercero/), 'Colegio Sur')
    await user.selectOptions(authorization, 'doc1')
    await user.type(within(dialog).getByLabelText(/Finalidad/), 'Solicitud del colegio')
    await user.selectOptions(within(dialog).getByLabelText(/Canal/), 'POSTAL')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }))

    expect(mockedApi.post).toHaveBeenCalledWith('/discharges/dis1/deliveries', {
      recipientType: 'THIRD_PARTY',
      recipientName: 'Colegio Sur',
      authorizationDocumentId: 'doc1',
      purpose: 'Solicitud del colegio',
      channel: 'POSTAL',
    })
  })

  it('al elegir un tercero avisa que verificar el documento es responsabilidad del terapeuta', async () => {
    const user = userEvent.setup()
    setup()
    const dialog = await openDialog(user)

    expect(within(dialog).queryByText(/Antes de entregar a un tercero/)).not.toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText(/Destinatario/), 'THIRD_PARTY')

    const notice = within(dialog).getByRole('note')
    expect(notice).toHaveTextContent(/Antes de entregar a un tercero/)
    expect(notice).toHaveTextContent(/poder notarial simple/)
    expect(notice).toHaveTextContent(/No comprueba su autenticidad ni su formalidad/)
  })

  it('sin autorizaciones cargadas explica cómo subirla y no deja registrar', async () => {
    const user = userEvent.setup()
    setup({ documents: [DOCUMENTS[2]] })
    const dialog = await openDialog(user)

    await user.selectOptions(within(dialog).getByLabelText(/Destinatario/), 'THIRD_PARTY')

    expect(await within(dialog).findByText(/Primero sube la autorización/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Registrar' })).toBeDisabled()
  })

  it('muestra el error del servidor y mantiene el diálogo abierto', async () => {
    const user = userEvent.setup()
    setup()
    mockedApi.post.mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'El informe no está emitido' } },
    })
    const dialog = await openDialog(user)

    await user.type(within(dialog).getByLabelText(/Finalidad/), 'Prueba')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }))

    expect(await within(dialog).findByText(/El informe no está emitido/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

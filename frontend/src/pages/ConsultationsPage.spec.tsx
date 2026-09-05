import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConsultationsPage from './ConsultationsPage'
import api from '../api/client'
import type { Patient, Consultation } from '../types/patient'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'patient-1',
    fullName: 'Paciente de Prueba',
    rut: '11111111-1',
    birthDate: '1990-01-01',
    consents: { TREATMENT: true, TELEMEDICINE: false },
    ...overrides,
  } as unknown as Patient
}

function buildConsultation(overrides: Partial<Consultation> = {}): Consultation {
  return {
    id: 'consultation-1',
    groupId: 'consultation-1',
    patientId: 'patient-1',
    sessionDate: '2026-05-20T12:00:00-04:00',
    consultReason: 'Motivo de la sesión',
    intervention: 'Intervención realizada',
    agreements: null,
    nextSessionDate: null,
    sessionType: 'IN_PERSON',
    therapist: { name: 'Terapeuta de Prueba' },
    history: [],
    ...overrides,
  } as unknown as Consultation
}

function renderConsultationsPage(initialEntry = '/consultations') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ConsultationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function selectFirstPatient(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Paciente de Prueba'))
}

describe('ConsultationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [] })
    })
  })

  it('sin paciente seleccionado pide elegir uno antes de mostrar el historial', async () => {
    renderConsultationsPage()

    expect(
      await screen.findByText('Selecciona un paciente para ver su historial'),
    ).toBeInTheDocument()
  })

  it('registrar sesión: crea la consulta para el paciente seleccionado y refresca la lista', async () => {
    const user = userEvent.setup()
    mockedApi.post.mockResolvedValueOnce({ data: buildConsultation() })

    renderConsultationsPage()
    await selectFirstPatient(user)

    await user.click(screen.getByRole('button', { name: /nueva consulta/i }))

    await user.selectOptions(screen.getByLabelText(/^paciente/i), 'patient-1')
    const sessionDateInput = document.getElementById(
      'consult-sessionDate',
    ) as HTMLInputElement
    await user.type(sessionDateInput, '2026-05-20')
    await user.type(
      screen.getByLabelText(/motivo de consulta/i),
      'Motivo de la sesión',
    )
    await user.type(
      screen.getByLabelText(/intervención realizada/i),
      'Intervención realizada',
    )

    await user.click(screen.getByRole('button', { name: /guardar sesión/i }))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/consultations',
        expect.objectContaining({
          patientId: 'patient-1',
          consultReason: 'Motivo de la sesión',
          intervention: 'Intervención realizada',
          sessionType: 'IN_PERSON',
          sessionDate: expect.stringMatching(/^2026-05-20T09:00:00/) as unknown as string,
        }),
      )
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /guardar sesión/i }),
      ).not.toBeInTheDocument()
    })
  })

  it('sin motivo de consulta no envía el formulario y muestra el error', async () => {
    const user = userEvent.setup()
    renderConsultationsPage()
    await selectFirstPatient(user)

    await user.click(screen.getByRole('button', { name: /nueva consulta/i }))
    await user.selectOptions(screen.getByLabelText(/^paciente/i), 'patient-1')
    const sessionDateInput = document.getElementById(
      'consult-sessionDate',
    ) as HTMLInputElement
    await user.type(sessionDateInput, '2026-05-20')
    await user.click(screen.getByRole('button', { name: /guardar sesión/i }))

    expect(
      await screen.findByText('El motivo de consulta es obligatorio'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('muestra el historial de consultas del paciente seleccionado', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({ data: [buildConsultation()] })
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Motivo de la sesión')).toBeInTheDocument()
    expect(screen.getByText('Intervención realizada')).toBeInTheDocument()
  })

  it('con ?patientId y consultationId en la URL, preselecciona el paciente y abre el modal de Corregir sesión (deep link desde una notificación)', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({ data: [buildConsultation()] })
      return Promise.resolve({ data: [] })
    })

    renderConsultationsPage('/consultations?patientId=patient-1&consultationId=consultation-1')

    expect(
      await screen.findByRole('heading', { name: 'Corregir Sesión' }),
    ).toBeInTheDocument()
  })

  // sdd/online-payment-integration PR 3 (T10.6): design.md REST table --
  // "PATCH /payments/:groupId ... NEVER part of the clinical Corregir
  // sesión modal". El monto por sesión se administra por un endpoint
  // separado (PaymentsPage / control dedicado), nunca desde este modal.
  it('el modal de Corregir sesión no tiene ningún control de monto de cobro', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({
          data: [
            buildConsultation({
              payment: {
                groupId: 'group-1',
                status: 'PENDING',
                linkDelivery: 'SENT',
                paymentUrl: 'https://flow.cl/pay/token-1',
                amount: 30000,
              },
            }),
          ],
        })
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)
    await user.click(await screen.findByTitle('Corregir sesión'))

    expect(
      await screen.findByRole('heading', { name: 'Corregir Sesión' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/monto/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$30\.000/)).not.toBeInTheDocument()
  })

  // sdd/online-payment-integration PR 3 (T9.6): el badge de estado de cobro
  // se resuelve directamente desde `c.payment` (ya viene armado por
  // ConsultationsService.getPaymentMap) -- sin cargo asociado no renderiza
  // nada (mismo comportamiento que PaymentStatusBadge con payment=null).
  it('muestra el badge de estado de cobro y el control de copiar link cuando la sesión tiene un cargo con link emitido', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({
          data: [
            buildConsultation({
              payment: {
                groupId: 'group-1',
                status: 'LATE',
                linkDelivery: 'SENT',
                paymentUrl: 'https://flow.cl/pay/token-1',
                amount: 30000,
              },
            }),
          ],
        })
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Cobro atrasado')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /copiar link de pago/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /reenviar link de pago/i }),
    ).toBeInTheDocument()
  })

  it('reenviar link de pago llama a POST /payments/:groupId/resend-link y muestra confirmación', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({
          data: [
            buildConsultation({
              payment: {
                groupId: 'group-1',
                status: 'LATE',
                linkDelivery: 'SENT',
                paymentUrl: 'https://flow.cl/pay/token-1',
                amount: 30000,
              },
            }),
          ],
        })
      return Promise.resolve({ data: [] })
    })
    mockedApi.post.mockResolvedValue({ data: {} })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    await user.click(
      screen.getByRole('button', { name: /reenviar link de pago/i }),
    )

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/payments/group-1/resend-link',
    )
    expect(await screen.findByText('Enviado')).toBeInTheDocument()
  })

  it('no muestra badge de cobro ni control de copiar link cuando la sesión no tiene cargo asociado', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({ data: [buildConsultation({ payment: null })] })
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Motivo de la sesión')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /copiar link de pago/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /reenviar link de pago/i }),
    ).not.toBeInTheDocument()
  })
})

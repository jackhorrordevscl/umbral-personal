import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
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

function LocationProbe() {
  return <span data-testid="location-search">{useLocation().search}</span>
}

function renderConsultationsPage(initialEntry = '/consultations') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <ConsultationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { queryClient }
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
      screen.getByRole('textbox', { name: /motivo de consulta/i }),
      'Motivo de la sesión',
    )
    await user.type(
      screen.getByRole('textbox', { name: /intervención realizada/i }),
      'Intervención realizada',
    )

    await user.click(screen.getByRole('button', { name: /guardar sesión/i }))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/consultations',
        expect.objectContaining({
          patientId: 'patient-1',
          // El editor rich-text (issue #159) persiste HTML, no texto plano.
          consultReason: '<p>Motivo de la sesión</p>',
          intervention: '<p>Intervención realizada</p>',
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

  it('mientras cargan las consultas muestra "Cargando consultas..." y no "Sin consultas registradas"', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/')) return new Promise(() => {})
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Cargando consultas...')).toBeInTheDocument()
    expect(screen.queryByText('Sin consultas registradas')).not.toBeInTheDocument()
  })

  it('con la carga terminada y sin sesiones muestra "Sin consultas registradas"', async () => {
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Sin consultas registradas')).toBeInTheDocument()
    expect(screen.queryByText('Cargando consultas...')).not.toBeInTheDocument()
  })

  it('si falla la carga de consultas no muestra "Sin consultas registradas"', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/')) return Promise.reject(new Error('boom'))
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText(/No se pudieron cargar las consultas/)).toBeInTheDocument()
    expect(screen.queryByText('Sin consultas registradas')).not.toBeInTheDocument()
  })

  // Issue #346: un refetch fallido conserva `data`; el historial ya cargado sigue visible.
  it('si un refetch falla con consultas en caché avisa pero mantiene el historial visible', async () => {
    let consultationsFail = false
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return consultationsFail
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ data: [buildConsultation()] })
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    const { queryClient } = renderConsultationsPage()
    await selectFirstPatient(user)
    await screen.findByText('Motivo de la sesión')

    consultationsFail = true
    await act(() => queryClient.refetchQueries())

    expect(await screen.findByText(/No se pudieron cargar las consultas/)).toBeInTheDocument()
    expect(screen.getByText('Motivo de la sesión')).toBeInTheDocument()
    expect(screen.getByText('Intervención realizada')).toBeInTheDocument()
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

  // Issue #159: el backend ya sanitiza consultReason/intervention/agreements
  // (whitelist p/br/strong/em/u/ul/ol/li), pero el frontend sanitiza de
  // nuevo con DOMPurify antes de dangerouslySetInnerHTML -- defensa en
  // profundidad ante HTML persistido que no venga limpio (dato histórico,
  // acceso directo a la DB, bug futuro en el backend).
  it('sanitiza el HTML de las notas clínicas antes de renderizarlas (defensa en profundidad)', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({
          data: [
            buildConsultation({
              consultReason: '<p>Motivo <strong>en negrita</strong></p><script>window.__xss = true</script>',
              intervention: '<img src=x onerror="window.__xss = true"><p>Intervención segura</p>',
            }),
          ],
        })
      return Promise.resolve({ data: [] })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('en negrita')).toBeInTheDocument()
    expect(screen.getByText('Intervención segura')).toBeInTheDocument()
    expect(document.querySelector('script')).not.toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeInTheDocument()
    expect((window as unknown as { __xss?: boolean }).__xss).not.toBe(true)
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

  describe('deep link con la consulta ausente del caché (#292)', () => {
    const deepLink = '/consultations?patientId=patient-1&consultationId=consultation-1'
    const consultationCalls = () =>
      mockedApi.get.mock.calls.filter(([url]) => String(url).startsWith('/consultations/patient/'))

    function mockConsultations(...responses: Array<Consultation[] | Error>) {
      let call = 0
      mockedApi.get.mockImplementation((url: string) => {
        if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
        if (url.startsWith('/consultations/patient/')) {
          const next = responses[Math.min(call++, responses.length - 1)]
          return next instanceof Error ? Promise.reject(next) : Promise.resolve({ data: next })
        }
        return Promise.resolve({ data: [] })
      })
    }

    it('refetchea una vez y abre el modal si la consulta aparece', async () => {
      mockConsultations([], [buildConsultation()])

      renderConsultationsPage(deepLink)

      expect(await screen.findByRole('heading', { name: 'Corregir Sesión' })).toBeInTheDocument()
      await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/))
      expect(consultationCalls()).toHaveLength(2)
    })

    it('si sigue ausente tras el refetch, limpia el parámetro sin entrar en bucle', async () => {
      mockConsultations([])

      renderConsultationsPage(deepLink)

      await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/))
      expect(screen.queryByRole('heading', { name: 'Corregir Sesión' })).not.toBeInTheDocument()
      expect(consultationCalls()).toHaveLength(2)
    })

    it('si el refetch falla, limpia el parámetro sin reintentar', async () => {
      mockConsultations([], new Error('network'))

      renderConsultationsPage(deepLink)

      await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/))
      expect(screen.queryByRole('heading', { name: 'Corregir Sesión' })).not.toBeInTheDocument()
      expect(consultationCalls()).toHaveLength(2)
    })
  })

  describe('Corregir sesión: validación y próxima sesión', () => {
    async function openCorrectModal(overrides: Partial<Consultation> = {}) {
      mockedApi.get.mockImplementation((url: string) => {
        if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
        if (url.startsWith('/consultations/patient/'))
          return Promise.resolve({ data: [buildConsultation(overrides)] })
        return Promise.resolve({ data: [] })
      })
      mockedApi.patch.mockResolvedValue({ data: buildConsultation() })
      const user = userEvent.setup()
      renderConsultationsPage()
      await selectFirstPatient(user)
      await user.click(await screen.findByTitle('Corregir sesión'))
      await screen.findByRole('heading', { name: 'Corregir Sesión' })
      return user
    }

    function clearField(id: string) {
      fireEvent.change(document.getElementById(id) as HTMLInputElement, {
        target: { value: '' },
      })
    }

    it('con la hora de sesión vacía muestra un mensaje claro y no envía', async () => {
      const user = await openCorrectModal()
      clearField('correct-sessionTime')
      await user.click(screen.getByRole('button', { name: 'Guardar corrección' }))

      expect(await screen.findByText('La hora de la sesión no es válida')).toBeInTheDocument()
      expect(mockedApi.patch).not.toHaveBeenCalled()
    })

    it('sin fecha de sesión no envía y avisa que es obligatoria', async () => {
      const user = await openCorrectModal()
      clearField('correct-sessionDate')
      await user.click(screen.getByRole('button', { name: 'Guardar corrección' }))

      expect(await screen.findByText('La fecha de sesión es obligatoria')).toBeInTheDocument()
      expect(mockedApi.patch).not.toHaveBeenCalled()
    })

    it('con la hora de la próxima sesión vacía no envía', async () => {
      const user = await openCorrectModal({ nextSessionDate: '2026-06-01T13:00:00-04:00' })
      clearField('correct-nextSessionTime')
      await user.click(screen.getByRole('button', { name: 'Guardar corrección' }))

      expect(
        await screen.findByText('La hora de la próxima sesión no es válida'),
      ).toBeInTheDocument()
      expect(mockedApi.patch).not.toHaveBeenCalled()
    })

    it('vaciar la fecha de la próxima sesión envía nextSessionDate null', async () => {
      const user = await openCorrectModal({ nextSessionDate: '2026-06-01T13:00:00-04:00' })
      clearField('correct-nextSessionDate')
      await user.click(screen.getByRole('button', { name: 'Guardar corrección' }))

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledWith(
          '/consultations/consultation-1/correct',
          expect.objectContaining({ nextSessionDate: null }),
        )
      })
    })
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
                lastError: null,
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
                lastError: null,
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
                lastError: null,
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

  // Issue #271: cobro rechazado por la pasarela (paymentUrl null + lastError).
  function mockPayment(payment: Record<string, unknown> | null) {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/patients') return Promise.resolve({ data: [buildPatient()] })
      if (url.startsWith('/consultations/patient/'))
        return Promise.resolve({
          data: [
            buildConsultation({
              payment: payment && {
                groupId: 'group-1',
                status: 'PENDING',
                linkDelivery: 'PENDING',
                paymentUrl: null,
                lastError: null,
                amount: 100,
                ...payment,
              },
            } as Partial<Consultation>),
          ],
        })
      return Promise.resolve({ data: [] })
    })
  }

  it('cobro sin link (PENDING): muestra "Cobro no generado" con el motivo y el botón de reintento', async () => {
    mockPayment({ lastError: 'El monto mínimo es 350 CLP' })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(
      await screen.findByText('Cobro no generado: El monto mínimo es 350 CLP'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reintentar cobro/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copiar link de pago/i })).not.toBeInTheDocument()
  })

  it('cobro sin link ni motivo (LATE): muestra "Cobro no generado" genérico', async () => {
    mockPayment({ status: 'LATE' })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Cobro no generado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reintentar cobro/i })).toBeInTheDocument()
  })

  it.each(['PAID', 'CANCELLED'])('no muestra cobro fallido ni reintento si el cargo está %s', async (status) => {
    mockPayment({ status, lastError: 'algo' })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Motivo de la sesión')).toBeInTheDocument()
    expect(screen.queryByText(/cobro no generado/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reintentar cobro/i })).not.toBeInTheDocument()
  })

  it.each(['PAID', 'CANCELLED'])('no muestra copiar ni reenviar link de pago si el cargo está %s', async (status) => {
    mockPayment({ status, paymentUrl: 'https://flow.cl/pay/token-1' })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByText('Motivo de la sesión')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copiar link de pago/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reenviar link de pago/i })).not.toBeInTheDocument()
  })

  it.each(['PENDING', 'LATE'])('muestra copiar y reenviar link de pago si el cargo está %s', async (status) => {
    mockPayment({ status, paymentUrl: 'https://flow.cl/pay/token-1' })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByRole('button', { name: /copiar link de pago/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reenviar link de pago/i })).toBeInTheDocument()
  })

  it('no muestra reintento si el cargo ya tiene paymentUrl', async () => {
    mockPayment({ paymentUrl: 'https://flow.cl/pay/token-1', lastError: 'viejo' })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)

    expect(await screen.findByRole('button', { name: /copiar link de pago/i })).toBeInTheDocument()
    expect(screen.queryByText(/cobro no generado/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reintentar cobro/i })).not.toBeInTheDocument()
  })

  it('reintentar cobro: llama a POST retry-charge y refresca la lista con el nuevo estado', async () => {
    mockPayment({ lastError: 'El monto mínimo es 350 CLP' })
    mockedApi.post.mockImplementation(() => {
      mockPayment({ paymentUrl: 'https://flow.cl/pay/token-2' })
      return Promise.resolve({ data: {} })
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)
    await user.click(await screen.findByRole('button', { name: /reintentar cobro/i }))

    expect(mockedApi.post).toHaveBeenCalledWith('/payments/group-1/retry-charge')
    expect(await screen.findByRole('button', { name: /copiar link de pago/i })).toBeInTheDocument()
    expect(screen.queryByText(/cobro no generado/i)).not.toBeInTheDocument()
  })

  it('reintentar cobro que falla: muestra el mensaje de error', async () => {
    mockPayment({ lastError: 'x' })
    mockedApi.post.mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'No tienes una cuenta de pagos conectada' } },
    })
    const user = userEvent.setup()

    renderConsultationsPage()
    await selectFirstPatient(user)
    await user.click(await screen.findByRole('button', { name: /reintentar cobro/i }))

    expect(
      await screen.findByText('No tienes una cuenta de pagos conectada'),
    ).toBeInTheDocument()
  })
})

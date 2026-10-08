import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PatientsPage from './PatientsPage'
import api from '../api/client'
import type { Patient } from '../types/patient'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildPatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'patient-1',
    fullName: 'Paciente Existente',
    rut: '11111111-1',
    birthDate: '1990-01-01',
    occupation: '',
    phone: '',
    email: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    treatingPsychiatrist: '',
    treatingDoctor: '',
    consents: { TREATMENT: true, TELEMEDICINE: false },
    isMinor: false,
    ageBand: 'ADULT',
    guardianCount: 0,
    minorStatus: 'NOT_MINOR',
    ...overrides,
  } as unknown as Patient
}

// issue #290: GET /patients responde { data, total, page, pageSize }.
function patientsPage(items: Patient[], total = items.length) {
  return { data: { data: items, total, page: 1, pageSize: 50 } }
}

function renderPatientsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientsPage />
    </QueryClientProvider>,
  )
}

async function fillMinimalRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/nombre completo/i), 'Nuevo Paciente')
  await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
  const birthDateInput = document.getElementById('patient-birthDate')!
  await user.type(birthDateInput, '1995-05-20')
}

describe('PatientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockResolvedValue(patientsPage([]))
  })

  it('lista los pacientes que devuelve el backend', async () => {
    mockedApi.get.mockResolvedValueOnce(patientsPage([buildPatient()]))

    renderPatientsPage()

    expect(
      (await screen.findAllByText('Paciente Existente'))[0],
    ).toBeInTheDocument()
  })

  it('issue #188: mientras carga muestra "cargando", no el estado vacío ni "0 pacientes"', async () => {
    let resolveList!: (value: ReturnType<typeof patientsPage>) => void
    mockedApi.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve
      }),
    )

    renderPatientsPage()

    expect(screen.getAllByText(/cargando pacientes/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/no se encontraron pacientes/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/0 pacientes registrados/i)).not.toBeInTheDocument()

    resolveList(patientsPage([]))

    expect((await screen.findAllByText(/no se encontraron pacientes/i)).length).toBeGreaterThan(0)
    expect(screen.getByText(/0 pacientes registrados/i)).toBeInTheDocument()
    expect(screen.queryByText(/cargando pacientes/i)).not.toBeInTheDocument()
  })

  it('alta de paciente: crea el paciente, otorga los consentimientos marcados y refresca la lista', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValueOnce(patientsPage([]))
    mockedApi.post.mockResolvedValueOnce({
      data: buildPatient({ id: 'new-patient' }),
    })
    mockedApi.post.mockResolvedValueOnce({ data: {} }) // POST .../consents

    renderPatientsPage()
    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))

    await fillMinimalRequiredFields(user)
    await user.click(screen.getByLabelText(/presencial/i))
    await user.click(screen.getByRole('button', { name: /guardar ficha/i }))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/patients',
        expect.objectContaining({
          fullName: 'Nuevo Paciente',
          rut: '12345678-5',
          birthDate: '1995-05-20',
        }),
      )
    })
    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/patients/new-patient/consents', {
        purpose: 'TREATMENT',
        action: 'GRANT',
        evidence: 'Otorgado durante la creación de la ficha',
      })
    })
    // El formulario se cierra y la lista se refetchea tras un alta exitosa.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /guardar ficha/i }),
      ).not.toBeInTheDocument()
    })
    expect(mockedApi.get).toHaveBeenCalledTimes(2)
  })

  it('issue #295: si falla un consentimiento del alta, el aviso queda visible tras cerrar el formulario y se limpia al reabrirlo', async () => {
    const user = userEvent.setup()
    mockedApi.post.mockResolvedValueOnce({ data: buildPatient({ id: 'new-patient' }) })
    mockedApi.post.mockRejectedValueOnce(new Error('boom')) // POST .../consents

    renderPatientsPage()
    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))
    await fillMinimalRequiredFields(user)
    await user.click(screen.getByLabelText(/presencial/i))
    await user.click(screen.getByRole('button', { name: /guardar ficha/i }))

    expect(
      await screen.findByText(/no se pudo registrar el consentimiento de 1 finalidad/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /guardar ficha/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))
    expect(screen.queryByText(/no se pudo registrar el consentimiento/i)).not.toBeInTheDocument()
  })

  it('issue #295: cancelar el alta reinicia el formulario', async () => {
    const user = userEvent.setup()
    renderPatientsPage()
    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))
    await user.type(screen.getByLabelText(/nombre completo/i), 'Nombre a medias')
    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))
    expect(screen.getByLabelText(/nombre completo/i)).toHaveValue('')
  })

  it('RUT inválido bloquea el envío sin llamar a la API', async () => {
    const user = userEvent.setup()
    renderPatientsPage()
    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))

    await user.type(screen.getByLabelText(/nombre completo/i), 'Nuevo Paciente')
    await user.type(screen.getByLabelText(/^rut/i), '11111111-2')
    const birthDateInput = document.getElementById('patient-birthDate')!
    await user.type(birthDateInput, '1995-05-20')
    await user.click(screen.getByRole('button', { name: /guardar ficha/i }))

    expect((await screen.findAllByText('RUT inválido'))[0]).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('RUT duplicado (409) muestra el error del backend y deja el formulario abierto', async () => {
    const user = userEvent.setup()
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: 'Ya existe un paciente con ese RUT' } },
    })

    renderPatientsPage()
    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))
    await fillMinimalRequiredFields(user)
    await user.click(screen.getByRole('button', { name: /guardar ficha/i }))

    expect(
      await screen.findByText('Ya existe un paciente con ese RUT'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar ficha/i })).toBeInTheDocument()
  })

  // Issue #131 (review R3-002): declaración retroactiva en bloque para
  // pacientes existentes sin PatientConsent -- no tenía ningún test.
  describe('Vista de tarjetas móvil (#356)', () => {
    it('renderiza las filas con todas sus acciones y la altura medida, sin recortarlas', async () => {
      const original = globalThis.ResizeObserver
      class FakeResizeObserver {
        private cb: ResizeObserverCallback
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb
        }
        observe(target: Element) {
          // Card alta (nombre envuelto en varias líneas): 320px en vez de los 208px estimados.
          this.cb(
            [
              {
                target,
                borderBoxSize: [{ blockSize: 320, inlineSize: 300 }],
                contentRect: { height: 320, width: 300 },
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          )
        }
        unobserve() {}
        disconnect() {}
      }
      globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
      try {
        mockedApi.get.mockResolvedValueOnce(
          patientsPage([
            buildPatient({ fullName: 'Paciente Tarjeta', email: 'tarjeta@example.com' }),
            buildPatient({ id: 'patient-2', fullName: 'Otro Paciente', rut: '22222222-2' }),
          ]),
        )

        const { container } = renderPatientsPage()
        const cards = container.querySelector('[class~="md:hidden"]') as HTMLElement
        expect(await within(cards).findByText('Paciente Tarjeta')).toBeInTheDocument()

        expect(within(cards).getAllByRole('button', { name: /^ver$/i })).toHaveLength(2)
        expect(within(cards).getAllByRole('button', { name: /^editar$/i })).toHaveLength(2)
        expect(within(cards).getAllByRole('button', { name: /^pdf$/i })).toHaveLength(2)
        expect(
          within(cards).getByRole('button', { name: 'Eliminar paciente Paciente Tarjeta' }),
        ).toBeInTheDocument()

        const row = within(cards).getByText('Paciente Tarjeta').closest('div[style]') as HTMLElement
        expect(row.style.transform).toBe('translateY(0px)')
        const second = within(cards).getByText('Otro Paciente').closest('div[style]') as HTMLElement
        // La segunda fila se posiciona según la altura medida, no la estimada (208px).
        expect(second.style.transform).toBe('translateY(320px)')
      } finally {
        globalThis.ResizeObserver = original
      }
    })
  })

  describe('Pacientes menores (bloque Menores, M5)', () => {
    it('marca en la lista a los menores sin representante o con consentimiento legado', async () => {
      mockedApi.get.mockResolvedValueOnce(
        patientsPage([
          buildPatient({ id: 'm1', fullName: 'Menor Sin Representante', minorStatus: 'MISSING_GUARDIAN' }),
          buildPatient({ id: 'm2', fullName: 'Menor Legado', minorStatus: 'LEGACY_CONSENT' }),
          buildPatient({ id: 'm3', fullName: 'Menor Al Día', minorStatus: 'OK' }),
        ]),
      )

      renderPatientsPage()
      await screen.findAllByText('Menor Sin Representante')

      expect(screen.getAllByText('Menor sin representante').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Menor: consentimiento por regularizar').length).toBeGreaterThan(0)
    })

    it('un adulto no muestra la marca de menor', async () => {
      mockedApi.get.mockResolvedValueOnce(patientsPage([buildPatient()]))

      renderPatientsPage()
      await screen.findAllByText('Paciente Existente')

      expect(screen.queryByText('Menor sin representante')).not.toBeInTheDocument()
    })
  })

  describe('Declaración retroactiva de consentimiento (issue #131)', () => {
    it('declara consentimiento en bloque para los pacientes seleccionados y limpia la selección', async () => {
      const user = userEvent.setup()
      const pending1 = buildPatient({
        id: 'pending-1',
        fullName: 'Paciente Pendiente Uno',
        rut: '22222222-2',
        consents: { TREATMENT: false, TELEMEDICINE: false },
      })
      const pending2 = buildPatient({
        id: 'pending-2',
        fullName: 'Paciente Pendiente Dos',
        rut: '33333333-3',
        consents: { TREATMENT: false, TELEMEDICINE: false },
      })
      mockedApi.get.mockResolvedValueOnce(patientsPage([pending1, pending2]))
      mockedApi.post.mockResolvedValueOnce({
        data: [
          { patientId: 'pending-1', ok: true },
          { patientId: 'pending-2', ok: true },
        ],
      })

      renderPatientsPage()
      await screen.findAllByText('Paciente Pendiente Uno')

      const checkbox1 = screen.getAllByLabelText(
        /declarar consentimiento retroactivo de paciente pendiente uno/i,
      )[0]
      const checkbox2 = screen.getAllByLabelText(
        /declarar consentimiento retroactivo de paciente pendiente dos/i,
      )[0]
      await user.click(checkbox1)
      await user.click(checkbox2)

      await user.type(
        screen.getByPlaceholderText(/evidencia/i),
        'Consentimiento en papel del expediente físico',
      )
      await user.click(screen.getByRole('button', { name: /^declarar$/i }))

      await waitFor(() => {
        expect(mockedApi.post).toHaveBeenCalledWith(
          '/patients/consents/bulk-declare',
          {
            patientIds: ['pending-1', 'pending-2'],
            purpose: 'TREATMENT',
            evidence: 'Consentimiento en papel del expediente físico',
          },
        )
      })
      // Tras el éxito, la barra de acción (ligada a la selección) desaparece.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /^declarar$/i }),
        ).not.toBeInTheDocument()
      })
    })

    it('issue #295: solo declara a los pacientes seleccionados que siguen visibles tras filtrar con el buscador', async () => {
      const user = userEvent.setup()
      const pending1 = buildPatient({
        id: 'pending-1',
        fullName: 'Ana Pendiente',
        rut: '22222222-2',
        consents: { TREATMENT: false, TELEMEDICINE: false },
      })
      const pending2 = buildPatient({
        id: 'pending-2',
        fullName: 'Beto Pendiente',
        rut: '33333333-3',
        consents: { TREATMENT: false, TELEMEDICINE: false },
      })
      // issue #290: el buscador filtra en el servidor.
      mockedApi.get.mockImplementation((_url, config) =>
        Promise.resolve(
          (config?.params as { search?: string } | undefined)?.search === 'Beto'
            ? patientsPage([pending2])
            : patientsPage([pending1, pending2]),
        ),
      )
      mockedApi.post.mockResolvedValueOnce({ data: [{ patientId: 'pending-2', ok: true }] })

      renderPatientsPage()
      await screen.findAllByText('Ana Pendiente')

      await user.click(screen.getAllByLabelText(/retroactivo de ana pendiente/i)[0])
      await user.click(screen.getAllByLabelText(/retroactivo de beto pendiente/i)[0])
      await user.type(screen.getByPlaceholderText(/buscar por nombre/i), 'Beto')

      expect(await screen.findByText(/retroactivo para 1 paciente/i)).toBeInTheDocument()
      await user.type(screen.getByPlaceholderText(/evidencia/i), 'Consentimiento en papel del expediente')
      await user.click(screen.getByRole('button', { name: /^declarar$/i }))

      await waitFor(() => {
        expect(mockedApi.post).toHaveBeenCalledWith('/patients/consents/bulk-declare', {
          patientIds: ['pending-2'],
          purpose: 'TREATMENT',
          evidence: 'Consentimiento en papel del expediente',
        })
      })
    })

    it('review R3-002: si un paciente del lote falla, igual limpia TODA la selección y avisa cuántos fallaron', async () => {
      const user = userEvent.setup()
      const pending1 = buildPatient({
        id: 'pending-1',
        fullName: 'Paciente Pendiente Uno',
        rut: '22222222-2',
        consents: { TREATMENT: false, TELEMEDICINE: false },
      })
      mockedApi.get.mockResolvedValueOnce(patientsPage([pending1]))
      mockedApi.post.mockResolvedValueOnce({
        data: [{ patientId: 'pending-1', ok: false, error: 'Paciente no encontrado' }],
      })

      renderPatientsPage()
      await screen.findAllByText('Paciente Pendiente Uno')

      const checkbox1 = screen.getAllByLabelText(
        /declarar consentimiento retroactivo de paciente pendiente uno/i,
      )[0]
      await user.click(checkbox1)
      await user.type(
        screen.getByPlaceholderText(/evidencia/i),
        'Consentimiento en papel del expediente físico',
      )
      await user.click(screen.getByRole('button', { name: /^declarar$/i }))

      expect(
        await screen.findByText(/1 paciente\(s\) no se pudieron declarar/i),
      ).toBeInTheDocument()
      // El comportamiento documentado por review R3-002: la barra de
      // acción desaparece igual (la selección se limpia entera), aunque el
      // lote haya fallado parcialmente.
      expect(
        screen.queryByRole('button', { name: /^declarar$/i }),
      ).not.toBeInTheDocument()
    })

    it('evidencia menor a 10 caracteres bloquea el envío sin llamar a la API', async () => {
      const user = userEvent.setup()
      const pending1 = buildPatient({
        id: 'pending-1',
        fullName: 'Paciente Pendiente Uno',
        rut: '22222222-2',
        consents: { TREATMENT: false, TELEMEDICINE: false },
      })
      mockedApi.get.mockResolvedValueOnce(patientsPage([pending1]))

      renderPatientsPage()
      await screen.findAllByText('Paciente Pendiente Uno')

      const checkbox1 = screen.getAllByLabelText(
        /declarar consentimiento retroactivo de paciente pendiente uno/i,
      )[0]
      await user.click(checkbox1)
      await user.type(screen.getByPlaceholderText(/evidencia/i), 'corta')
      await user.click(screen.getByRole('button', { name: /^declarar$/i }))

      expect(
        await screen.findByText(/al menos 10 caracteres/i),
      ).toBeInTheDocument()
      expect(mockedApi.post).not.toHaveBeenCalled()
    })
  })

  it('eliminar paciente pide confirmación y llama al DELETE recién al confirmar', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValueOnce(patientsPage([buildPatient()]))
    mockedApi.delete.mockResolvedValueOnce({ data: undefined })

    renderPatientsPage()
    await screen.findAllByText('Paciente Existente')

    await user.click(screen.getByLabelText(/eliminar a paciente existente/i))
    const dialog = await screen.findByRole('dialog')
    expect(mockedApi.delete).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: /eliminar/i }))

    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith('/patients/patient-1')
    })
  })

  it('issue #290: el contador usa el total del servidor, no los pacientes cargados', async () => {
    mockedApi.get.mockResolvedValueOnce(patientsPage([buildPatient()], 731))

    renderPatientsPage()

    expect(await screen.findByText('731 pacientes registrados')).toBeInTheDocument()
  })

  it('issue #290: buscar pide al servidor (con espera) y vuelve a la página 1', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((_url, config) => {
      const params = config?.params as { page?: number; search?: string } | undefined
      if (params?.search === 'Ana') {
        return Promise.resolve(patientsPage([buildPatient({ id: 'ana', fullName: 'Ana Buscada' })], 1))
      }
      return Promise.resolve(patientsPage([buildPatient()], 120))
    })

    renderPatientsPage()
    await screen.findAllByText('Paciente Existente')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith('/patients', {
        params: { page: 2, pageSize: 50, search: undefined },
      }),
    )

    await user.type(screen.getByRole('textbox', { name: /buscar pacientes/i }), 'Ana')

    expect((await screen.findAllByText('Ana Buscada'))[0]).toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledWith('/patients', {
      params: { page: 1, pageSize: 50, search: 'Ana' },
    })
    expect(screen.getByText('1 resultado para la búsqueda')).toBeInTheDocument()
    // No se pidió una consulta por cada tecla.
    const searchCalls = mockedApi.get.mock.calls.filter(
      ([, c]) => (c?.params as { search?: string } | undefined)?.search,
    )
    expect(searchCalls).toHaveLength(1)
  })

  it('issue #290: pagina con Anterior/Siguiente usando el total del servidor', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValue(patientsPage([buildPatient()], 120))

    renderPatientsPage()
    await screen.findAllByText('Paciente Existente')

    const nav = screen.getByRole('navigation', { name: /paginación de pacientes/i })
    expect(within(nav).getByText(/página 1 de 3/i)).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /anterior/i })).toBeDisabled()

    await user.click(within(nav).getByRole('button', { name: /siguiente/i }))

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith('/patients', {
        params: { page: 2, pageSize: 50, search: undefined },
      }),
    )
  })

  it('issue #290: sin más de una página no muestra controles de paginación', async () => {
    mockedApi.get.mockResolvedValue(patientsPage([buildPatient()], 1))

    renderPatientsPage()
    await screen.findAllByText('Paciente Existente')

    expect(screen.queryByRole('navigation', { name: /paginación de pacientes/i })).not.toBeInTheDocument()
  })

  it('issue #290: si la página actual queda vacía (p. ej. tras eliminar) vuelve a la última con datos', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((_url, config) => {
      const params = config?.params as { page?: number } | undefined
      return Promise.resolve(
        params?.page === 2 ? patientsPage([], 50) : patientsPage([buildPatient()], 120),
      )
    })

    renderPatientsPage()
    await screen.findAllByText('Paciente Existente')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    await waitFor(() => {
      const pages = mockedApi.get.mock.calls.map(([, c]) => (c?.params as { page?: number }).page)
      expect(pages.slice(-1)[0]).toBe(1)
      expect(pages).toContain(2)
    })
  })
})


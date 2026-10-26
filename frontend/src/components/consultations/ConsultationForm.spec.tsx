import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConsultationForm from './ConsultationForm'
import axios from 'axios'
import api from '../../api/client'

// Issue #294: el select de pacientes ignoraba carga y error y se veía como
// "sin pacientes".

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderForm() {
  const onSuccess = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ConsultationForm onSuccess={onSuccess} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )
  return { queryClient, onSuccess }
}

const patient = { id: 'patient-1', fullName: 'Paciente de Prueba', rut: '11111111-1' }

describe('ConsultationForm — select de pacientes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mientras cargan los pacientes el select está deshabilitado y lo indica', async () => {
    mockedApi.get.mockImplementation(() => new Promise(() => {}))

    renderForm()

    const select = await screen.findByLabelText(/Paciente/)
    expect(select).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Cargando pacientes...' })).toBeInTheDocument()
  })

  it('si falla la carga deshabilita el select, muestra el error y permite reintentar', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockRejectedValueOnce(new Error('boom'))
    mockedApi.get.mockResolvedValue({ data: { data: [patient], total: 1, page: 1, pageSize: 20 } })

    renderForm()

    expect(
      await screen.findByText('No se pudieron cargar los pacientes.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Paciente/)).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(
      await screen.findByRole('option', { name: /Paciente de Prueba/ }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Paciente/)).toBeEnabled()
  })

  // Issue #346: un refetch fallido conserva `data`; la lista ya cargada sirve.
  it('si un refetch falla con pacientes en caché avisa pero mantiene la lista y el select habilitado', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: [patient], total: 1, page: 1, pageSize: 20 } })

    const { queryClient } = renderForm()

    await screen.findByRole('option', { name: /Paciente de Prueba/ })
    mockedApi.get.mockRejectedValue(new Error('boom'))
    await act(() => queryClient.refetchQueries())

    expect(
      await screen.findByText('No se pudieron cargar los pacientes.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Paciente/)).toBeEnabled()
    expect(screen.getByRole('option', { name: /Paciente de Prueba/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: 'No se pudieron cargar los pacientes' }),
    ).not.toBeInTheDocument()
  })
})

// Issue #290: el selector busca en el servidor en vez de cargar todos los pacientes.
describe('ConsultationForm — búsqueda de pacientes en el servidor (#290)', () => {
  const other = { id: 'patient-2', fullName: 'Otra Persona', rut: '22222222-2' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pide una página chica y avisa cuando hay más pacientes que los mostrados', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: [patient], total: 45, page: 1, pageSize: 20 } })

    renderForm()

    await screen.findByRole('option', { name: /Paciente de Prueba/ })
    expect(mockedApi.get).toHaveBeenCalledWith('/patients', {
      params: { page: 1, pageSize: 20, search: undefined },
    })
    expect(screen.getByText(/Mostrando 1 de 45 pacientes/)).toBeInTheDocument()
  })

  it('al escribir busca en el servidor con espera y conserva el paciente ya elegido', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((_url, config) => {
      const search = (config?.params as { search?: string } | undefined)?.search
      return Promise.resolve({
        data: search === 'Otra'
          ? { data: [other], total: 1, page: 1, pageSize: 20 }
          : { data: [patient], total: 1, page: 1, pageSize: 20 },
      })
    })

    renderForm()
    await screen.findByRole('option', { name: /Paciente de Prueba/ })
    await user.selectOptions(screen.getByLabelText(/Paciente/, { selector: 'select' }), 'patient-1')

    await user.type(screen.getByRole('searchbox', { name: /buscar paciente/i }), 'Otra')

    // El select (no el panel de resultados) conserva al paciente elegido.
    const select = screen.getByLabelText(/Paciente/, { selector: 'select' })
    expect(await within(select).findByRole('option', { name: /Otra Persona/ })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: /Paciente de Prueba/ })).toBeInTheDocument()
    expect(select).toHaveValue('patient-1')
    await waitFor(() => {
      const searches = mockedApi.get.mock.calls
        .map(([, c]) => (c?.params as { search?: string } | undefined)?.search)
        .filter(Boolean)
      expect(searches).toEqual(['Otra'])
    })
  })

  // El select cerrado ocultaba los resultados: al buscar, un panel bajo el
  // buscador lista las coincidencias (nombre y RUT) y al elegir una se cierra.
  describe('panel de resultados', () => {
    const searchResults = (search?: string) => {
      if (search === 'Otra') return { data: [other], total: 1, page: 1, pageSize: 20 }
      if (search === 'zzz') return { data: [], total: 0, page: 1, pageSize: 20 }
      return { data: [patient, other], total: 2, page: 1, pageSize: 20 }
    }

    beforeEach(() => {
      mockedApi.get.mockImplementation((_url, config) =>
        Promise.resolve({
          data: searchResults((config?.params as { search?: string } | undefined)?.search),
        }),
      )
    })

    const searchbox = () => screen.getByRole('searchbox', { name: /buscar paciente/i })

    it('muestra nombre y RUT de cada coincidencia y cierra el panel al elegir', async () => {
      const user = userEvent.setup()
      renderForm()
      await screen.findByRole('option', { name: /Paciente de Prueba/ })
      expect(screen.queryByRole('listbox', { name: /resultados/i })).not.toBeInTheDocument()

      await user.type(searchbox(), 'Otra')

      const panel = await screen.findByRole('listbox', { name: /resultados/i })
      const option = await within(panel).findByRole('option', { name: /Otra Persona/ })
      expect(option).toHaveTextContent('22222222-2')

      await user.click(option)

      expect(screen.queryByRole('listbox', { name: /resultados/i })).not.toBeInTheDocument()
      expect(screen.getByLabelText(/Paciente/, { selector: 'select' })).toHaveValue('patient-2')
      expect(searchbox()).toHaveValue('')
    })

    it('avisa cuando la búsqueda no tiene resultados', async () => {
      const user = userEvent.setup()
      renderForm()
      await screen.findByRole('option', { name: /Paciente de Prueba/ })

      await user.type(searchbox(), 'zzz')

      expect(await screen.findByText(/Sin resultados para/)).toBeInTheDocument()
    })

    it('Enter elige la primera coincidencia sin enviar el formulario', async () => {
      const user = userEvent.setup()
      renderForm()
      await screen.findByRole('option', { name: /Paciente de Prueba/ })

      await user.type(searchbox(), 'Otra')
      const panel = await screen.findByRole('listbox', { name: /resultados/i })
      // Los resultados se asientan cuando la búsqueda se acota a una sola fila.
      await waitFor(() => expect(within(panel).getAllByRole('option')).toHaveLength(1))
      await user.keyboard('{Enter}')

      expect(screen.getByLabelText(/Paciente/, { selector: 'select' })).toHaveValue('patient-2')
      expect(screen.queryByText('Selecciona un paciente')).not.toBeInTheDocument()
    })

    it('Escape cierra el panel y limpia la búsqueda', async () => {
      const user = userEvent.setup()
      renderForm()
      await screen.findByRole('option', { name: /Paciente de Prueba/ })

      await user.type(searchbox(), 'Otra')
      await screen.findByRole('listbox', { name: /resultados/i })
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('listbox', { name: /resultados/i })).not.toBeInTheDocument()
      expect(searchbox()).toHaveValue('')
    })
  })
})

describe('ConsultationForm — validación de horas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockResolvedValue({ data: { data: [patient], total: 1, page: 1, pageSize: 20 } })
  })

  async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('option', { name: /Paciente de Prueba/ })
    await user.selectOptions(screen.getByLabelText(/Paciente/), 'patient-1')
    await user.type(screen.getByLabelText(/Fecha de sesión/), '2026-10-05')
    await user.type(screen.getByRole('textbox', { name: 'Motivo de consulta' }), 'Ansiedad')
    await user.type(
      screen.getByRole('textbox', { name: 'Intervención realizada / Registro de evolución clínica' }),
      'Respiración',
    )
  }

  it('una hora de sesión inválida muestra el mensaje y no envía', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillRequiredFields(user)

    await user.clear(screen.getByLabelText(/Hora de sesión/))
    await user.click(screen.getByRole('button', { name: 'Guardar sesión' }))

    expect(await screen.findByText('La hora de la sesión no es válida')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('una hora de próxima sesión inválida muestra el mensaje y no envía', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillRequiredFields(user)

    await user.type(screen.getByLabelText(/Próxima sesión — Fecha/), '2026-10-12')
    await user.clear(screen.getByLabelText(/Próxima sesión — Hora/))
    await user.click(screen.getByRole('button', { name: 'Guardar sesión' }))

    expect(
      await screen.findByText('La hora de la próxima sesión no es válida'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })
})

describe('ConsultationForm — paciente con tratamiento cerrado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockResolvedValue({ data: { data: [patient], total: 1, page: 1, pageSize: 20 } })
  })

  const closedError = Object.assign(new Error('closed'), {
    isAxiosError: true,
    response: { status: 409, data: { code: 'PATIENT_TREATMENT_CLOSED', message: 'cerrado' } },
  })

  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('option', { name: /Paciente de Prueba/ })
    await user.selectOptions(screen.getByLabelText(/Paciente/), 'patient-1')
    await user.type(screen.getByLabelText(/Fecha de sesión/), '2026-10-05')
    await user.type(screen.getByRole('textbox', { name: 'Motivo de consulta' }), 'Ansiedad')
    await user.type(
      screen.getByRole('textbox', { name: 'Intervención realizada / Registro de evolución clínica' }),
      'Respiración',
    )
    await user.click(screen.getByRole('button', { name: 'Guardar sesión' }))
  }

  it('pide confirmar la reapertura y reenvía con reopenPatient', async () => {
    expect(axios.isAxiosError(closedError)).toBe(true)
    mockedApi.post
      .mockRejectedValueOnce(closedError)
      .mockResolvedValueOnce({ data: { id: 'c1', groupId: 'g1' } })
    const user = userEvent.setup()
    const { onSuccess } = renderForm()
    await fillAndSubmit(user)

    expect(
      await screen.findByText('El paciente tiene el tratamiento cerrado. ¿Reabrirlo y agendar la consulta?'),
    ).toBeInTheDocument()
    expect(mockedApi.post.mock.calls[0][1]).not.toHaveProperty('reopenPatient')

    await user.click(screen.getByRole('button', { name: 'Reabrir y agendar' }))

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(2))
    expect(mockedApi.post.mock.calls[1][1]).toMatchObject({ patientId: 'patient-1', reopenPatient: true })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('si se cancela el diálogo no reenvía', async () => {
    mockedApi.post.mockRejectedValueOnce(closedError)
    const user = userEvent.setup()
    renderForm()
    await fillAndSubmit(user)

    await screen.findByText(/tiene el tratamiento cerrado/)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByText(/tiene el tratamiento cerrado/)).not.toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledTimes(1)
  })
})

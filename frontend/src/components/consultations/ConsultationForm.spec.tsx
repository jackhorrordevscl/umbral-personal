import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConsultationForm from './ConsultationForm'
import api from '../../api/client'

// Issue #294: el select de pacientes ignoraba carga y error y se veía como
// "sin pacientes".

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ConsultationForm onSuccess={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )
  return { queryClient }
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

    expect(await screen.findByRole('option', { name: /Otra Persona/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Paciente de Prueba/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/Paciente/, { selector: 'select' })).toHaveValue('patient-1')
    await waitFor(() => {
      const searches = mockedApi.get.mock.calls
        .map(([, c]) => (c?.params as { search?: string } | undefined)?.search)
        .filter(Boolean)
      expect(searches).toEqual(['Otra'])
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

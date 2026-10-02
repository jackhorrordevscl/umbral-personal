import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  return render(
    <QueryClientProvider client={queryClient}>
      <ConsultationForm onSuccess={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )
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
    mockedApi.get.mockResolvedValue({ data: [patient] })

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
})

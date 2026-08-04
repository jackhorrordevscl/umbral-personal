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
    ...overrides,
  } as unknown as Patient
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
    mockedApi.get.mockResolvedValue({ data: [] })
  })

  it('lista los pacientes que devuelve el backend', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [buildPatient()] })

    renderPatientsPage()

    expect(
      (await screen.findAllByText('Paciente Existente'))[0],
    ).toBeInTheDocument()
  })

  it('alta de paciente: crea el paciente, otorga los consentimientos marcados y refresca la lista', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValueOnce({ data: [] })
    mockedApi.post.mockResolvedValueOnce({
      data: buildPatient({ id: 'new-patient' }),
    })
    mockedApi.post.mockResolvedValueOnce({ data: {} }) // POST .../consents

    renderPatientsPage()
    await user.click(screen.getByRole('button', { name: /nuevo paciente/i }))

    await fillMinimalRequiredFields(user)
    await user.click(screen.getByLabelText(/tratamiento/i))
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

  it('eliminar paciente pide confirmación y llama al DELETE recién al confirmar', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockResolvedValueOnce({ data: [buildPatient()] })
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
})

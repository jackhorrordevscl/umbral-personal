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
      mockedApi.get.mockResolvedValueOnce({ data: [pending1, pending2] })
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

    it('review R3-002: si un paciente del lote falla, igual limpia TODA la selección y avisa cuántos fallaron', async () => {
      const user = userEvent.setup()
      const pending1 = buildPatient({
        id: 'pending-1',
        fullName: 'Paciente Pendiente Uno',
        rut: '22222222-2',
        consents: { TREATMENT: false, TELEMEDICINE: false },
      })
      mockedApi.get.mockResolvedValueOnce({ data: [pending1] })
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
      mockedApi.get.mockResolvedValueOnce({ data: [pending1] })

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

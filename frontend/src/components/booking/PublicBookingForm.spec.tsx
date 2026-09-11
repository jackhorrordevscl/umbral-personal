import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PublicBookingForm from './PublicBookingForm'
import api from '../../api/client'

// sdd/patient-self-scheduling PR 5 (tasks.md 5.3/5.4, public-scheduling Req:
// "Patient Identity Resolution by Email"): formulario reducido de la agenda
// pública, wireado a POST .../availability/book. La resolución
// existente-vs-nueva ocurre en el backend (PatientsService.resolveForPublicBooking)
// -- desde el frontend, ambos casos son la MISMA request con datos distintos;
// estos dos tests prueban que el payload armado (incluyendo el email
// puntual de cada caso) llega intacto y que el componente reacciona igual
// (onSuccess) a la respuesta 201 en ambos.

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderForm(props: Partial<React.ComponentProps<typeof PublicBookingForm>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onSuccess = vi.fn()
  const onSlotTaken = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <PublicBookingForm
        therapistId="therapist-1"
        slotStart="2026-09-20T13:00:00.000Z"
        onSuccess={onSuccess}
        onSlotTaken={onSlotTaken}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onSuccess, onSlotTaken }
}

async function fillAndSubmit(email: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/nombre completo/i), 'Juana Pérez')
  await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
  await user.type(screen.getByLabelText(/fecha de nacimiento/i), '1990-05-01')
  await user.type(screen.getByLabelText(/^email/i), email)
  await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))
}

describe('PublicBookingForm — public-scheduling Req: Patient Identity Resolution by Email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reserva con el email de un paciente existente arma el payload correcto y confirma', async () => {
    mockedApi.post.mockResolvedValue({
      data: { id: 'consult-1', sessionDate: '2026-09-20T13:00:00.000Z' },
    })
    const { onSuccess } = renderForm()

    await fillAndSubmit('existente@example.com')

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/public/therapists/therapist-1/availability/book',
        {
          slotStart: '2026-09-20T13:00:00.000Z',
          patient: {
            fullName: 'Juana Pérez',
            rut: '12345678-5',
            birthDate: '1990-05-01',
            email: 'existente@example.com',
          },
        },
      ),
    )
    expect(onSuccess).toHaveBeenCalledWith({
      id: 'consult-1',
      sessionDate: '2026-09-20T13:00:00.000Z',
    })
  })

  it('reserva con un email nuevo también arma el payload correcto y confirma', async () => {
    mockedApi.post.mockResolvedValue({
      data: { id: 'consult-2', sessionDate: '2026-09-20T13:00:00.000Z' },
    })
    const { onSuccess } = renderForm()

    await fillAndSubmit('nuevo-paciente@example.com')

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/public/therapists/therapist-1/availability/book',
        expect.objectContaining({
          patient: expect.objectContaining({ email: 'nuevo-paciente@example.com' }),
        }),
      ),
    )
    expect(onSuccess).toHaveBeenCalledWith({
      id: 'consult-2',
      sessionDate: '2026-09-20T13:00:00.000Z',
    })
  })

  it('rechaza un RUT inválido y no llama a la API', async () => {
    const { onSuccess } = renderForm()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/nombre completo/i), 'Juana Pérez')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-9')
    await user.type(screen.getByLabelText(/fecha de nacimiento/i), '1990-05-01')
    await user.type(screen.getByLabelText(/^email/i), 'x@example.com')
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByText('RUT inválido')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('un 409 al reservar delega en onSlotTaken en vez de mostrar un error genérico', async () => {
    mockedApi.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { message: 'El horario seleccionado ya no está disponible.' } },
    })
    const { onSlotTaken, onSuccess } = renderForm()

    await fillAndSubmit('choque@example.com')

    await waitFor(() => expect(onSlotTaken).toHaveBeenCalled())
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

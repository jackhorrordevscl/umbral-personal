import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PublicBookingForm from './PublicBookingForm'
import api from '../../api/client'
import { toChileDayKey } from '../../utils/datetime'

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

  // issue #157: el form solo reenvía el `origin` que ya le pasó
  // PublicBookingPage.tsx (utm_source + document.referrer derivados al
  // montar) -- no lo recalcula ni lo transforma.
  it('cuando se pasa origin como prop, lo incluye en el payload de la reserva', async () => {
    mockedApi.post.mockResolvedValue({
      data: { id: 'consult-3', sessionDate: '2026-09-20T13:00:00.000Z' },
    })
    const origin = { source: 'google', referrer: 'https://google.com/' }
    renderForm({ origin })

    await fillAndSubmit('con-origen@example.com')

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/public/therapists/therapist-1/availability/book',
        expect.objectContaining({ origin }),
      ),
    )
  })

  it('sin origin (undefined), la reserva funciona igual y no rompe el payload', async () => {
    mockedApi.post.mockResolvedValue({
      data: { id: 'consult-4', sessionDate: '2026-09-20T13:00:00.000Z' },
    })
    const { onSuccess } = renderForm()

    await fillAndSubmit('sin-origen@example.com')

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/public/therapists/therapist-1/availability/book',
        {
          slotStart: '2026-09-20T13:00:00.000Z',
          patient: {
            fullName: 'Juana Pérez',
            rut: '12345678-5',
            birthDate: '1990-05-01',
            email: 'sin-origen@example.com',
          },
        },
      ),
    )
    expect(onSuccess).toHaveBeenCalled()
  })
})

// Booking for a minor: the visitor marks the toggle, enters the patient's
// data plus the legal guardian's. The server stays the authority on
// minor-ness; these specs cover the client hints and the payload shape.

// YYYY-MM-DD birth date `years` years before today's Chile day (relative, so
// the specs never expire).
function birthDateYearsAgo(years: number): string {
  const [y, m, d] = toChileDayKey(new Date().toISOString()).split('-').map(Number)
  return new Date(Date.UTC(y - years, m - 1, d)).toISOString().slice(0, 10)
}

const MINOR_BIRTH_DATE = birthDateYearsAgo(10)

async function fillMinor(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { guardianRut?: string; guardianEmail?: string; patientEmail?: string; phone?: string } = {},
) {
  await user.click(screen.getByLabelText('Reservo para un menor de edad'))
  await user.type(screen.getByLabelText(/nombre completo del paciente/i), 'Tomás Pérez')
  await user.type(screen.getByLabelText(/rut del paciente/i), '12345678-5')
  await user.type(screen.getByLabelText(/fecha de nacimiento del paciente/i), MINOR_BIRTH_DATE)
  if (overrides.patientEmail) {
    await user.type(screen.getByLabelText(/correo del paciente/i), overrides.patientEmail)
  }
  await user.type(screen.getByLabelText(/nombre completo del representante/i), 'Juana Pérez')
  await user.type(screen.getByLabelText(/rut del representante/i), overrides.guardianRut ?? '11111111-1')
  await user.selectOptions(screen.getByLabelText(/relación con el paciente/i), 'MOTHER')
  if (overrides.guardianEmail !== '') {
    await user.type(
      screen.getByLabelText(/correo del representante/i),
      overrides.guardianEmail ?? 'juana@example.com',
    )
  }
  if (overrides.phone) {
    await user.type(screen.getByLabelText(/teléfono del representante/i), overrides.phone)
  }
}

describe('PublicBookingForm — reserva por un menor de edad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.post.mockResolvedValue({
      data: { id: 'consult-m', sessionDate: '2026-09-20T13:00:00.000Z' },
    })
  })

  it('el interruptor está apagado por defecto y muestra el bloque del representante al activarlo', async () => {
    renderForm()
    const user = userEvent.setup()
    const toggle = screen.getByLabelText('Reservo para un menor de edad')
    expect(toggle).not.toBeChecked()
    expect(screen.queryByRole('group', { name: 'Datos del representante legal' })).not.toBeInTheDocument()

    await user.click(toggle)

    const group = screen.getByRole('group', { name: 'Datos del representante legal' })
    expect(group).toBeInTheDocument()
    expect(screen.getByLabelText(/nombre completo del paciente/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Correo del paciente (opcional)')).toBeInTheDocument()
    const relationship = screen.getByLabelText(/relación con el paciente/i)
    for (const label of ['Madre', 'Padre', 'Tutor/a legal', 'Curador/a', 'Cuidador/a', 'Otro/a']) {
      expect(within(relationship).getByRole('option', { name: label })).toBeInTheDocument()
    }
  })

  it('arma el payload con patient (sin email vacío) y guardian (sin teléfono vacío)', async () => {
    const { onSuccess } = renderForm()
    const user = userEvent.setup()

    await fillMinor(user, { guardianRut: '11.111.111-1' })
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/public/therapists/therapist-1/availability/book', {
        slotStart: '2026-09-20T13:00:00.000Z',
        patient: { fullName: 'Tomás Pérez', rut: '12345678-5', birthDate: MINOR_BIRTH_DATE },
        guardian: {
          fullName: 'Juana Pérez',
          rut: '11111111-1',
          relationship: 'MOTHER',
          email: 'juana@example.com',
        },
      }),
    )
    const payload = mockedApi.post.mock.calls[0][1] as Record<string, Record<string, unknown>>
    expect(payload.patient).not.toHaveProperty('email')
    expect(payload.guardian).not.toHaveProperty('phone')
    expect(onSuccess).toHaveBeenCalled()
  })

  it('incluye el email del paciente y el teléfono del representante cuando se completan', async () => {
    renderForm()
    const user = userEvent.setup()

    await fillMinor(user, { patientEmail: 'tomas@example.com', phone: '+56911112222' })
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/public/therapists/therapist-1/availability/book',
        expect.objectContaining({
          patient: expect.objectContaining({ email: 'tomas@example.com' }),
          guardian: expect.objectContaining({ phone: '+56911112222' }),
        }),
      ),
    )
  })

  it('el payload de un adulto no incluye guardian aunque se haya abierto y cerrado el modo menor', async () => {
    renderForm()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Reservo para un menor de edad'))
    await user.type(screen.getByLabelText(/nombre completo del representante/i), 'Alguien')
    await user.click(screen.getByLabelText('Reservo para un menor de edad'))

    await fillAndSubmit('adulto@example.com')

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/public/therapists/therapist-1/availability/book', {
        slotStart: '2026-09-20T13:00:00.000Z',
        patient: {
          fullName: 'Juana Pérez',
          rut: '12345678-5',
          birthDate: '1990-05-01',
          email: 'adulto@example.com',
        },
      }),
    )
    const payload = mockedApi.post.mock.calls[0][1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('guardian')
  })

  it('rechaza un RUT del representante igual al del paciente', async () => {
    renderForm()
    const user = userEvent.setup()

    await fillMinor(user, { guardianRut: '12.345.678-5' })
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(
      await screen.findByText('El RUT del representante debe ser distinto al del paciente.'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('exige el correo del representante', async () => {
    renderForm()
    const user = userEvent.setup()

    await fillMinor(user, { guardianEmail: '' })
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByText('El correo del representante es obligatorio')).toBeInTheDocument()
    expect(screen.getByLabelText(/correo del representante/i)).toHaveAttribute('aria-invalid', 'true')
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('en modo menor, una fecha de nacimiento de 18 años o más muestra un error', async () => {
    renderForm()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Reservo para un menor de edad'))
    await user.type(screen.getByLabelText(/fecha de nacimiento del paciente/i), birthDateYearsAgo(18))
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(
      await screen.findByText('El paciente debe ser menor de 18 años para reservar por un menor.'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('en modo adulto, una fecha de nacimiento de menor de 18 años pide marcar la opción', async () => {
    renderForm()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/nombre completo/i), 'Tomás Pérez')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
    await user.type(screen.getByLabelText(/fecha de nacimiento/i), MINOR_BIRTH_DATE)
    await user.type(screen.getByLabelText(/^email/i), 'tomas@example.com')
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(
      await screen.findByText(
        'Si el paciente es menor de 18 años, marca la opción «Reservo para un menor de edad».',
      ),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('el email del paciente sigue siendo obligatorio en modo adulto', async () => {
    renderForm()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/nombre completo/i), 'Juana Pérez')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
    await user.type(screen.getByLabelText(/fecha de nacimiento/i), '1990-05-01')
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByText('El email es obligatorio')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })
})

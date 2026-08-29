import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PatientForm, { type PatientFormValues } from './PatientForm'
import type { ConsentStatus } from '../../types/patient'

function buildForm(overrides: Partial<PatientFormValues> = {}): PatientFormValues {
  return {
    fullName: '',
    rut: '',
    birthDate: '',
    occupation: '',
    phone: '',
    email: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    treatingPsychiatrist: '',
    treatingDoctor: '',
    defaultSessionAmount: '',
    ...overrides,
  }
}

function buildConsents(overrides: Partial<ConsentStatus> = {}): ConsentStatus {
  return { TREATMENT: false, TELEMEDICINE: false, ...overrides }
}

function renderForm(overrides: Partial<React.ComponentProps<typeof PatientForm>> = {}) {
  const props = {
    form: buildForm(),
    onChange: vi.fn(),
    consents: buildConsents(),
    onConsentsChange: vi.fn(),
    rutError: '',
    onRutChange: vi.fn(),
    formError: '',
    isPending: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<PatientForm {...props} />)
  return props
}

describe('PatientForm', () => {
  it('escribir el nombre completo llama a onChange con el form actualizado', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.type(screen.getByLabelText(/nombre completo/i), 'A')

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'A' }),
    )
  })

  it('escribir el RUT llama a onRutChange, no a onChange', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.type(screen.getByLabelText(/^rut/i), '1')

    expect(props.onRutChange).toHaveBeenCalledWith('1')
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('muestra el error de RUT cuando rutError viene seteado', () => {
    renderForm({ rutError: 'RUT inválido' })

    expect(screen.getByText('RUT inválido')).toBeInTheDocument()
  })

  it('tildar un checkbox de consentimiento llama a onConsentsChange', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.click(screen.getByLabelText(/tratamiento/i))

    expect(props.onConsentsChange).toHaveBeenCalledWith(
      expect.objectContaining({ TREATMENT: true }),
    )
  })

  it('enviar el formulario llama a onSubmit', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.click(screen.getByRole('button', { name: /guardar ficha/i }))

    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('cancelar llama a onCancel', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.click(screen.getByRole('button', { name: /cancelar/i }))

    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('muestra el error general del formulario cuando formError viene seteado', () => {
    renderForm({ formError: 'Ya existe un paciente con ese RUT' })

    expect(
      screen.getByText('Ya existe un paciente con ese RUT'),
    ).toBeInTheDocument()
  })

  it('deshabilita el botón de guardar mientras isPending es true', () => {
    renderForm({ isPending: true })

    expect(screen.getByRole('button', { name: /guardando/i })).toBeDisabled()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GuardianForm from './GuardianForm'
import type { LegalGuardian } from '../../types/patient'

function renderForm(overrides: Partial<React.ComponentProps<typeof GuardianForm>> = {}) {
  const props = {
    isPending: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<GuardianForm {...props} />)
  return props
}

const existing: LegalGuardian = {
  id: 'g1',
  patientId: 'p1',
  fullName: 'Ana Pérez',
  rut: '12345678-5',
  relationship: 'FATHER',
  email: 'ana@example.com',
  phone: null,
  isPayer: true,
  receivesCommunications: false,
  canAccessReports: true,
  canConsent: true,
  custody: 'SHARED',
  hasConflict: false,
}

describe('GuardianForm', () => {
  it('exige nombre y RUT antes de enviar', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.click(screen.getByRole('button', { name: /agregar representante/i }))

    expect(screen.getByText('El nombre es obligatorio')).toBeInTheDocument()
    expect(screen.getByText('El RUT es obligatorio')).toBeInTheDocument()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('limita el teléfono a 30 caracteres', () => {
    renderForm()

    expect(screen.getByLabelText(/teléfono/i)).toHaveAttribute('maxlength', '30')
  })

  it('rechaza un RUT inválido', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.type(screen.getByLabelText(/nombre completo/i), 'Ana Pérez')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-0')
    await user.click(screen.getByRole('button', { name: /agregar representante/i }))

    expect(screen.getByText('RUT inválido')).toBeInTheDocument()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('envía el payload con los defaults del servidor y el RUT normalizado', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.type(screen.getByLabelText(/nombre completo/i), '  Ana Pérez ')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
    await user.click(screen.getByRole('button', { name: /agregar representante/i }))

    expect(props.onSubmit).toHaveBeenCalledWith({
      fullName: 'Ana Pérez',
      rut: '12345678-5',
      relationship: 'MOTHER',
      email: '',
      phone: '',
      custody: 'UNKNOWN',
      canConsent: true,
      receivesCommunications: true,
      canAccessReports: true,
      isPayer: false,
      hasConflict: false,
    })
  })

  it('permite elegir relación, custodia y permisos', async () => {
    const user = userEvent.setup()
    const props = renderForm()

    await user.type(screen.getByLabelText(/nombre completo/i), 'Luis Soto')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
    await user.selectOptions(screen.getByLabelText(/relación con el paciente/i), 'CURATOR')
    await user.selectOptions(screen.getByLabelText(/cuidado personal/i), 'SOLE')
    await user.click(screen.getByLabelText(/es el pagador/i))
    await user.click(screen.getByLabelText(/hay conflicto/i))
    await user.click(screen.getByLabelText(/puede otorgar consentimiento/i))
    await user.click(screen.getByRole('button', { name: /agregar representante/i }))

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        relationship: 'CURATOR',
        custody: 'SOLE',
        isPayer: true,
        hasConflict: true,
        canConsent: false,
      }),
    )
  })

  it('al editar precarga los valores y ofrece guardar cambios', async () => {
    const user = userEvent.setup()
    const props = renderForm({ initial: existing })

    expect(screen.getByLabelText(/nombre completo/i)).toHaveValue('Ana Pérez')
    expect(screen.getByLabelText(/^rut/i)).toHaveValue('12.345.678-5')
    expect(screen.getByLabelText(/recibe comunicaciones/i)).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ rut: '12345678-5', relationship: 'FATHER', isPayer: true }),
    )
  })

  it('muestra el error del servidor y llama a onCancel', async () => {
    const user = userEvent.setup()
    const props = renderForm({ error: 'Ya existe un representante con ese RUT' })

    expect(screen.getByText('Ya existe un representante con ese RUT')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })
})

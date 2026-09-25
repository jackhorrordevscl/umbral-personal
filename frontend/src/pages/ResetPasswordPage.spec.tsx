import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ResetPasswordPage from './ResetPasswordPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('con token en la URL envía la nueva contraseña y confirma la actualización', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/reset-password?token=reset-abc']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    )
    await user.type(screen.getByLabelText('Nueva contraseña'), 'NuevaPass123!')
    await user.click(screen.getByRole('button', { name: /actualizar contraseña/i }))

    expect(await screen.findByText('Contraseña actualizada')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/password/reset', {
      resetToken: 'reset-abc',
      newPassword: 'NuevaPass123!',
    })
  })

  it('sin token muestra enlace inválido y no llama a la API', () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Enlace inválido')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })
})

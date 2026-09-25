import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import SignupPage from './SignupPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registro exitoso envía los datos y muestra la pantalla de revisar email', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    )
    await user.type(screen.getByLabelText('Nombre completo'), 'Ana Pérez')
    await user.type(screen.getByLabelText('Email'), 'ana@umbral.cl')
    await user.type(screen.getByLabelText('Contraseña'), 'Password123!')
    await user.type(screen.getByLabelText('Código de invitación'), 'INV-123')
    await user.click(screen.getByRole('button', { name: /crear cuenta/i }))

    expect(await screen.findByText('Revisa tu email')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/signup', {
      name: 'Ana Pérez',
      email: 'ana@umbral.cl',
      password: 'Password123!',
      inviteCode: 'INV-123',
    })
  })
})

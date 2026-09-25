import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import MfaRecoverPage from './MfaRecoverPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('MfaRecoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('envía credenciales y código de recuperación y confirma que MFA fue desactivado', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <MfaRecoverPage />
      </MemoryRouter>,
    )
    await user.type(screen.getByLabelText('Email'), 'ana@umbral.cl')
    await user.type(screen.getByLabelText('Contraseña'), 'Password123!')
    await user.type(
      screen.getByLabelText('Código de recuperación'),
      'a1b2-c3d4-e5f6-a7b8-c9d0',
    )
    await user.click(screen.getByRole('button', { name: /desactivar mfa/i }))

    expect(await screen.findByText('MFA desactivado')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/mfa/recover', {
      email: 'ana@umbral.cl',
      password: 'Password123!',
      recoveryCode: 'a1b2-c3d4-e5f6-a7b8-c9d0',
    })
  })
})

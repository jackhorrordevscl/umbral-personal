import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ForgotPasswordPage from './ForgotPasswordPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('envía el email y muestra la pantalla de revisar email', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    )
    await user.type(screen.getByLabelText('Email'), 'ana@umbral.cl')
    await user.click(screen.getByRole('button', { name: /enviar enlace/i }))

    expect(await screen.findByText('Revisa tu email')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/password/forgot', {
      email: 'ana@umbral.cl',
    })
  })
})

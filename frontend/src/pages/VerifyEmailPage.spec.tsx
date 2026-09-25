import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import VerifyEmailPage from './VerifyEmailPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('con token en la URL verifica el email y muestra el éxito', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })

    render(
      <MemoryRouter initialEntries={['/verify-email?token=verify-abc']}>
        <VerifyEmailPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Email verificado')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/verify-email', {
      token: 'verify-abc',
    })
  })

  it('sin token muestra el error y no llama a la API', () => {
    render(
      <MemoryRouter initialEntries={['/verify-email']}>
        <VerifyEmailPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('No se pudo verificar')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })
})

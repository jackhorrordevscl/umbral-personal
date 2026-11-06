import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import VerifyEmailPage from './VerifyEmailPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderPage(entry = '/verify-email?token=verify-abc') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <VerifyEmailPage />
    </MemoryRouter>,
  )
}

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('con token no llama a la API hasta que se elige la contraseña', () => {
    renderPage()

    expect(screen.getByText('Elige tu contraseña')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('envía el token con la contraseña elegida y muestra el éxito', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Contraseña'), 'Password123!')
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Password123!')
    await user.click(screen.getByRole('button', { name: /verificar y activar/i }))

    expect(await screen.findByText('Email verificado')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/verify-email', {
      token: 'verify-abc',
      password: 'Password123!',
    })
  })

  it('no envía nada si las contraseñas no coinciden', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Contraseña'), 'Password123!')
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Distinta123!')
    await user.click(screen.getByRole('button', { name: /verificar y activar/i }))

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('no envía nada si la contraseña tiene menos de 8 caracteres', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Contraseña'), 'corta1')
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'corta1')
    await user.click(screen.getByRole('button', { name: /verificar y activar/i }))

    expect(await screen.findByText('Mínimo 8 caracteres')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('muestra el error del backend si el token no sirve', async () => {
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: 'Token de verificación inválido o expirado' } },
    })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Contraseña'), 'Password123!')
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'Password123!')
    await user.click(screen.getByRole('button', { name: /verificar y activar/i }))

    expect(
      await screen.findByText('Token de verificación inválido o expirado'),
    ).toBeInTheDocument()
  })

  it('sin token muestra el error y no llama a la API', () => {
    renderPage('/verify-email')

    expect(screen.getByText('No se pudo verificar')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })
})

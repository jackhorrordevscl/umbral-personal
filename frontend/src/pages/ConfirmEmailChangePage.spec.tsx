import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ConfirmEmailChangePage from './ConfirmEmailChangePage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderPage(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ConfirmEmailChangePage />
    </MemoryRouter>,
  )
}

describe('ConfirmEmailChangePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el estado de confirmación mientras la solicitud está en curso', () => {
    mockedApi.post.mockReturnValueOnce(new Promise(() => {}))

    renderPage(['/confirm-email-change?token=valid-token'])

    expect(screen.getByText('Confirmando tu nuevo email...')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/profile/email-change/confirm', {
      token: 'valid-token',
    })
  })

  it('confirmación exitosa muestra el mensaje de éxito', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })

    renderPage(['/confirm-email-change?token=valid-token'])

    expect(await screen.findByText('Email actualizado')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Tu email fue actualizado. Ya puedes iniciar sesión con la nueva dirección.',
      ),
    ).toBeInTheDocument()
  })

  it('token faltante muestra error sin llamar al backend', () => {
    renderPage(['/confirm-email-change'])

    expect(screen.getByText('No se pudo confirmar')).toBeInTheDocument()
    expect(
      screen.getByText('Enlace de confirmación inválido: falta el token.'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('token expirado o inválido muestra el mensaje de error del backend', async () => {
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: 'El token expiró o es inválido.' } },
    })

    renderPage(['/confirm-email-change?token=expired-token'])

    expect(await screen.findByText('No se pudo confirmar')).toBeInTheDocument()
    expect(await screen.findByText('El token expiró o es inválido.')).toBeInTheDocument()
  })

  it('incluye un enlace para volver a iniciar sesión', () => {
    renderPage(['/confirm-email-change'])

    expect(screen.getByRole('link', { name: 'Ir a iniciar sesión' })).toHaveAttribute(
      'href',
      '/login',
    )
  })
})

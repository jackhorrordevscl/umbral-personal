import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import SignupPage from './SignupPage'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function mockSignupConfig(openSignup: boolean) {
  mockedApi.get.mockResolvedValue({ data: { openSignup } })
}

function renderSignup(initialEntry = '/signup') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SignupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillBaseFields(
  user: ReturnType<typeof userEvent.setup>,
  confirmPassword = 'Password123!',
) {
  await user.type(await screen.findByLabelText('Nombre completo'), 'Ana Pérez')
  await user.type(screen.getByLabelText('Email'), 'ana@umbral.cl')
  await user.type(screen.getByLabelText('Contraseña'), 'Password123!')
  await user.type(screen.getByLabelText('Confirmar contraseña'), confirmPassword)
}

describe('SignupPage — registro por invitación (suscripciones apagadas)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignupConfig(false)
  })

  it('registro exitoso envía los datos y muestra la pantalla de revisar email', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()

    renderSignup()
    await fillBaseFields(user)
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

  it('no envía el registro y muestra error si las contraseñas no coinciden', async () => {
    const user = userEvent.setup()

    renderSignup()
    await fillBaseFields(user, 'Distinta123!')
    await user.type(screen.getByLabelText('Código de invitación'), 'INV-123')
    await user.click(screen.getByRole('button', { name: /crear cuenta/i }))

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('exige el código de invitación y no muestra el campo promocional', async () => {
    const user = userEvent.setup()

    renderSignup()
    await fillBaseFields(user)
    expect(screen.queryByLabelText(/código promocional/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /crear cuenta/i }))

    expect(
      await screen.findByText('El código de invitación es obligatorio'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })
})

describe('SignupPage — registro abierto (suscripciones encendidas, issue #611)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignupConfig(true)
  })

  it('no pide invitación y envía el código promocional cuando se escribe', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()

    renderSignup()
    await fillBaseFields(user)
    expect(screen.queryByLabelText('Código de invitación')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/código promocional/i), 'FLYER-1')
    await user.click(screen.getByRole('button', { name: /crear cuenta/i }))

    expect(await screen.findByText('Revisa tu email')).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/signup', {
      name: 'Ana Pérez',
      email: 'ana@umbral.cl',
      password: 'Password123!',
      promoCode: 'FLYER-1',
    })
  })

  it('permite registrarse sin código promocional y no envía el campo', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} })
    const user = userEvent.setup()

    renderSignup()
    await fillBaseFields(user)
    await user.click(screen.getByRole('button', { name: /crear cuenta/i }))

    expect(await screen.findByText('Revisa tu email')).toBeInTheDocument()
    const body = mockedApi.post.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('promoCode')
    expect(body).not.toHaveProperty('inviteCode')
  })

  it('precarga el código promocional desde la URL (?promo=)', async () => {
    renderSignup('/signup?promo=QR-NOV')

    expect(await screen.findByLabelText(/código promocional/i)).toHaveValue('QR-NOV')
  })
})

describe('SignupPage — configuración no disponible', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('si no se puede leer la configuración muestra un error y no el formulario', async () => {
    mockedApi.get.mockRejectedValue(new Error('network'))

    renderSignup()

    expect(
      await screen.findByText(/no se pudo cargar el formulario de registro/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre completo')).not.toBeInTheDocument()
  })
})

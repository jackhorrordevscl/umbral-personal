import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GuardiansSection from './GuardiansSection'
import api from '../../api/client'
import type { LegalGuardian } from '../../types/patient'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildGuardian(overrides: Partial<LegalGuardian> = {}): LegalGuardian {
  return {
    id: 'g1',
    patientId: 'p1',
    fullName: 'Ana Pérez',
    rut: '12345678-5',
    relationship: 'MOTHER',
    email: 'ana@example.com',
    phone: null,
    isPayer: true,
    receivesCommunications: true,
    canAccessReports: true,
    canConsent: true,
    custody: 'SOLE',
    hasConflict: false,
    ...overrides,
  }
}

function renderSection(onChanged = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <GuardiansSection patientId="p1" onChanged={onChanged} />
    </QueryClientProvider>,
  )
  return onChanged
}

function mockGuardians(list: LegalGuardian[]) {
  mockedApi.get.mockImplementation((url: string) => {
    if (url === '/patients/p1/guardians') return Promise.resolve({ data: list })
    return Promise.resolve({ data: [] })
  })
}

describe('GuardiansSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista los representantes con relación, RUT y etiquetas', async () => {
    mockGuardians([buildGuardian()])
    renderSection()

    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText(/Madre · 12\.345\.678-5/)).toBeInTheDocument()
    expect(screen.getByText('Consiente')).toBeInTheDocument()
    expect(screen.getByText('Pagador')).toBeInTheDocument()
  })

  it('sin representantes muestra el estado vacío', async () => {
    mockGuardians([])
    renderSection()

    expect(await screen.findByText('Sin representantes registrados.')).toBeInTheDocument()
  })

  it('agrega un representante y avisa con onChanged', async () => {
    const user = userEvent.setup()
    mockGuardians([])
    mockedApi.post.mockResolvedValue({ data: buildGuardian() })
    const onChanged = renderSection()

    await user.click(await screen.findByRole('button', { name: /agregar representante/i }))
    await user.type(screen.getByLabelText(/nombre completo/i), 'Ana Pérez')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
    await user.click(screen.getByRole('button', { name: /^agregar representante$/i }))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/patients/p1/guardians',
        expect.objectContaining({ fullName: 'Ana Pérez', rut: '12345678-5' }),
      ),
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('muestra el mensaje 409 del servidor al guardar', async () => {
    const user = userEvent.setup()
    mockGuardians([])
    mockedApi.post.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        isAxiosError: true,
        response: { status: 409, data: { message: 'Ya existe un representante con ese RUT' } },
      }),
    )
    renderSection()

    await user.click(await screen.findByRole('button', { name: /agregar representante/i }))
    await user.type(screen.getByLabelText(/nombre completo/i), 'Ana Pérez')
    await user.type(screen.getByLabelText(/^rut/i), '12345678-5')
    await user.click(screen.getByRole('button', { name: /^agregar representante$/i }))

    expect(await screen.findByText('Ya existe un representante con ese RUT')).toBeInTheDocument()
  })

  it('edita un representante con PATCH', async () => {
    const user = userEvent.setup()
    mockGuardians([buildGuardian()])
    mockedApi.patch.mockResolvedValue({ data: buildGuardian() })
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Editar a Ana Pérez' }))
    await user.click(screen.getByLabelText(/hay conflicto/i))
    await user.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith(
        '/patients/p1/guardians/g1',
        expect.objectContaining({ hasConflict: true }),
      ),
    )
  })

  it('quita un representante tras confirmar', async () => {
    const user = userEvent.setup()
    mockGuardians([buildGuardian()])
    mockedApi.delete.mockResolvedValue({ data: {} })
    const onChanged = renderSection()

    await user.click(await screen.findByRole('button', { name: 'Quitar a Ana Pérez' }))
    await user.click(screen.getByRole('button', { name: /^quitar$/i }))

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith('/patients/p1/guardians/g1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('muestra el 409 de un representante referenciado por un consentimiento', async () => {
    const user = userEvent.setup()
    mockGuardians([buildGuardian()])
    mockedApi.delete.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        isAxiosError: true,
        response: {
          status: 409,
          data: { message: 'El representante está referenciado por un consentimiento' },
        },
      }),
    )
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Quitar a Ana Pérez' }))
    await user.click(screen.getByRole('button', { name: /^quitar$/i }))

    expect(
      await screen.findByText('El representante está referenciado por un consentimiento'),
    ).toBeInTheDocument()
  })

  it('con 2 representantes no ofrece agregar más', async () => {
    mockGuardians([buildGuardian(), buildGuardian({ id: 'g2', fullName: 'Luis Soto' })])
    renderSection()

    expect(await screen.findByText('Luis Soto')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agregar representante/i })).not.toBeInTheDocument()
    expect(screen.getByText(/máximo de 2 representantes/i)).toBeInTheDocument()
  })
})

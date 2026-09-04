import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PaymentsPage from './PaymentsPage'
import api from '../api/client'
import type { PaymentAccountStatus } from '../hooks/usePaymentAccount'

// sdd/payments-multigateway-redesign tasks 4.3-4.5 (design.md sequence
// "Connect account — after", spec "Guided Connection Wizard With
// Pre-Persistence Validation" / "Flow rejects well-formed but invalid
// credentials"): covers the paste step's client-side format gate, the
// confirmation step's Decision 1 commerce-name fallback, and the two
// wizard paths (happy path / invalid-key path) end to end through the real
// component tree, mocking only the network boundary -- same convention as
// ConsultationsPage.spec.tsx / PatientsPage.spec.tsx. The repo has no
// browser e2e harness (no Playwright/Cypress config anywhere), so "E2E" for
// task 4.5 is this same RTL integration style, not a separate framework.

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

// Matches CREDENTIAL_FORMAT in both PaymentsPage.tsx and the backend's
// ValidateCredentialsDto: /^[A-Za-z0-9_-]{16,128}$/.
const VALID_API_KEY = 'A'.repeat(20)
const VALID_SECRET_KEY = 'B'.repeat(20)

function buildAccount(
  overrides: Partial<PaymentAccountStatus> = {},
): PaymentAccountStatus {
  return {
    status: 'PENDING',
    provider: 'FLOW',
    displayName: null,
    keyFingerprint: null,
    connectedAt: null,
    lastError: null,
    ...overrides,
  }
}

function renderPaymentsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>,
  )
}

async function navigateToPasteStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /comenzar/i }))
  await user.click(
    screen.getByRole('button', { name: /ya tengo una cuenta en flow/i }),
  )
  await user.click(
    screen.getByRole('button', { name: /ya tengo mis credenciales/i }),
  )
}

async function fillCredentials(
  user: ReturnType<typeof userEvent.setup>,
  apiKey: string,
  secretKey: string,
) {
  await user.type(screen.getByLabelText(/^api key/i), apiKey)
  await user.type(screen.getByLabelText(/^secret key/i), secretKey)
}

describe('PaymentsPage — connection wizard (payments-multigateway-redesign)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/payments/account') {
        return Promise.resolve({ data: buildAccount() })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
  })

  it('el paso de pegar credenciales bloquea un valor mal formado sin llamar a la red', async () => {
    const user = userEvent.setup()
    renderPaymentsPage()
    await navigateToPasteStep(user)

    await user.type(screen.getByLabelText(/^api key/i), 'short')
    await user.type(screen.getByLabelText(/^secret key/i), '???')
    await user.click(screen.getByRole('button', { name: /validar credenciales/i }))

    expect(
      await screen.findByText('La API Key no tiene el formato esperado por Flow.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('La Secret Key no tiene el formato esperado por Flow.'),
    ).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })

  it('el paso de confirmación muestra el nombre de comercio que devuelve Flow', async () => {
    const user = userEvent.setup()
    mockedApi.post.mockResolvedValueOnce({
      data: { accountLabel: 'Consultorio Ejemplo', keyFingerprint: 'fp-abc123' },
    })

    renderPaymentsPage()
    await navigateToPasteStep(user)
    await fillCredentials(user, VALID_API_KEY, VALID_SECRET_KEY)
    await user.click(screen.getByRole('button', { name: /validar credenciales/i }))

    expect(
      await screen.findByText('Comercio: Consultorio Ejemplo'),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/nombre para identificar esta cuenta/i),
    ).not.toBeInTheDocument()
  })

  it('el paso de confirmación permite un rótulo escrito por el terapeuta si Flow no devuelve nombre de comercio', async () => {
    const user = userEvent.setup()
    mockedApi.post.mockResolvedValueOnce({
      data: { keyFingerprint: 'fp-xyz789' },
    })

    renderPaymentsPage()
    await navigateToPasteStep(user)
    await fillCredentials(user, VALID_API_KEY, VALID_SECRET_KEY)
    await user.click(screen.getByRole('button', { name: /validar credenciales/i }))

    const displayNameInput = await screen.findByLabelText(
      /nombre para identificar esta cuenta/i,
    )
    await user.type(displayNameInput, 'Mi Consultorio')

    expect(displayNameInput).toHaveValue('Mi Consultorio')
    expect(screen.queryByText(/^Comercio:/)).not.toBeInTheDocument()
  })

  it('E2E — camino feliz: bienvenida → Flow → credenciales → pegar y validar → confirmar conecta la cuenta', async () => {
    const user = userEvent.setup()
    let connected = false
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/payments/account') {
        return Promise.resolve({
          data: connected
            ? buildAccount({
                status: 'CONNECTED',
                displayName: 'Mi Consultorio',
                keyFingerprint: 'fp-xyz789',
                connectedAt: '2026-01-01T00:00:00Z',
              })
            : buildAccount(),
        })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    mockedApi.post.mockImplementation((url: string) => {
      if (url === '/payments/account/validate') {
        return Promise.resolve({ data: { keyFingerprint: 'fp-xyz789' } })
      }
      if (url === '/payments/account') {
        connected = true
        return Promise.resolve({
          data: buildAccount({
            status: 'CONNECTED',
            displayName: 'Mi Consultorio',
            keyFingerprint: 'fp-xyz789',
            connectedAt: '2026-01-01T00:00:00Z',
          }),
        })
      }
      return Promise.reject(new Error(`POST inesperado: ${url}`))
    })

    renderPaymentsPage()
    await navigateToPasteStep(user)
    await fillCredentials(user, VALID_API_KEY, VALID_SECRET_KEY)
    await user.click(screen.getByRole('button', { name: /validar credenciales/i }))

    const displayNameInput = await screen.findByLabelText(
      /nombre para identificar esta cuenta/i,
    )
    await user.type(displayNameInput, 'Mi Consultorio')
    await user.click(screen.getByRole('button', { name: /confirmar y conectar/i }))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/payments/account', {
        apiKey: VALID_API_KEY,
        secretKey: VALID_SECRET_KEY,
        displayName: 'Mi Consultorio',
      })
    })
    expect(await screen.findByText(/cuenta conectada/i)).toBeInTheDocument()
  })

  it('E2E — camino de clave inválida: Flow rechaza credenciales bien formadas y el terapeuta permanece en el paso de pegar (spec "Flow rejects well-formed but invalid credentials")', async () => {
    const user = userEvent.setup()
    mockedApi.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: 'Flow no reconoció estas credenciales.' } },
    })

    renderPaymentsPage()
    await navigateToPasteStep(user)
    await fillCredentials(user, VALID_API_KEY, VALID_SECRET_KEY)
    await user.click(screen.getByRole('button', { name: /validar credenciales/i }))

    expect(
      await screen.findByText('Flow no reconoció estas credenciales.'),
    ).toBeInTheDocument()
    // Persists nothing and stays on the paste step -- only the failed
    // validate() call happened, connect() was never attempted.
    expect(
      screen.getByRole('button', { name: /validar credenciales/i }),
    ).toBeInTheDocument()
    expect(mockedApi.post).toHaveBeenCalledTimes(1)
  })

  // sdd-verify (Unit 4 re-verify, 2026-09-04) flagged these three spec
  // scenarios from the payment-gateway-connection spec ("Reconnection of
  // Legacy-Invalidated Accounts" / "Abandoning the Wizard Persists
  // Nothing") as CRITICAL missing-test findings: the implementation in
  // usePaymentAccount.ts / PaymentsPage.tsx was already correct and
  // unchanged, only runtime coverage was missing.

  it('spec "Legacy account is flagged and blocked from silent charge creation": una cuenta RECONNECT_REQUIRED muestra el banner de reconexión', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/payments/account') {
        return Promise.resolve({
          data: buildAccount({ status: 'RECONNECT_REQUIRED' }),
        })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })

    renderPaymentsPage()

    expect(
      await screen.findByText(/tu cuenta necesita reconectarse/i),
    ).toBeInTheDocument()
  })

  it('spec "Reconnecting restores automatic charge creation": completar el asistente desde RECONNECT_REQUIRED conecta la cuenta y retira el banner', async () => {
    const user = userEvent.setup()
    let connected = false
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/payments/account') {
        return Promise.resolve({
          data: connected
            ? buildAccount({
                status: 'CONNECTED',
                displayName: 'Mi Consultorio',
                keyFingerprint: 'fp-reconnect',
                connectedAt: '2026-01-01T00:00:00Z',
              })
            : buildAccount({ status: 'RECONNECT_REQUIRED' }),
        })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    mockedApi.post.mockImplementation((url: string) => {
      if (url === '/payments/account/validate') {
        return Promise.resolve({ data: { keyFingerprint: 'fp-reconnect' } })
      }
      if (url === '/payments/account') {
        connected = true
        return Promise.resolve({
          data: buildAccount({
            status: 'CONNECTED',
            displayName: 'Mi Consultorio',
            keyFingerprint: 'fp-reconnect',
            connectedAt: '2026-01-01T00:00:00Z',
          }),
        })
      }
      return Promise.reject(new Error(`POST inesperado: ${url}`))
    })

    renderPaymentsPage()

    expect(
      await screen.findByText(/tu cuenta necesita reconectarse/i),
    ).toBeInTheDocument()

    await navigateToPasteStep(user)
    await fillCredentials(user, VALID_API_KEY, VALID_SECRET_KEY)
    await user.click(screen.getByRole('button', { name: /validar credenciales/i }))

    const displayNameInput = await screen.findByLabelText(
      /nombre para identificar esta cuenta/i,
    )
    await user.type(displayNameInput, 'Mi Consultorio')
    await user.click(screen.getByRole('button', { name: /confirmar y conectar/i }))

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/payments/account', {
        apiKey: VALID_API_KEY,
        secretKey: VALID_SECRET_KEY,
        displayName: 'Mi Consultorio',
      })
    })
    expect(await screen.findByText(/cuenta conectada/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/tu cuenta necesita reconectarse/i),
    ).not.toBeInTheDocument()
  })

  it('spec "Leaving mid-wizard changes nothing persisted": salir del asistente tras validar sin confirmar no llama a connect() ni muta la cuenta', async () => {
    const user = userEvent.setup()
    mockedApi.post.mockImplementation((url: string) => {
      if (url === '/payments/account/validate') {
        return Promise.resolve({ data: { keyFingerprint: 'fp-abandoned' } })
      }
      return Promise.reject(new Error(`POST inesperado: ${url}`))
    })

    const { unmount } = renderPaymentsPage()
    await navigateToPasteStep(user)
    await fillCredentials(user, VALID_API_KEY, VALID_SECRET_KEY)
    await user.click(screen.getByRole('button', { name: /validar credenciales/i }))

    // Reaches the confirmation step: validate() succeeded (read-only, spec
    // "Abandoning the Wizard Persists Nothing"), but connect() has not been
    // called yet.
    await screen.findByRole('button', { name: /confirmar y conectar/i })
    expect(mockedApi.post).toHaveBeenCalledTimes(1)
    expect(mockedApi.post).toHaveBeenCalledWith('/payments/account/validate', {
      apiKey: VALID_API_KEY,
      secretKey: VALID_SECRET_KEY,
    })

    // The therapist closes the wizard instead of confirming.
    unmount()

    // No account-mutating request (connect via POST /payments/account, or
    // disconnect via DELETE) was ever fired -- only the read-only
    // validate() call happened before the wizard was abandoned.
    expect(mockedApi.post).toHaveBeenCalledTimes(1)
    expect(mockedApi.post).not.toHaveBeenCalledWith(
      '/payments/account',
      expect.anything(),
    )
    expect(mockedApi.delete).not.toHaveBeenCalled()

    // "WHEN they return later THEN the account's persisted status is
    // unchanged from before they started" -- re-rendering fetches the same
    // unconnected account and the wizard starts fresh from 'welcome'.
    renderPaymentsPage()
    expect(
      await screen.findByRole('button', { name: /comenzar/i }),
    ).toBeInTheDocument()
  })
})

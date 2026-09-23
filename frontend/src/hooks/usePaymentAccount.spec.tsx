import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  usePaymentAccount,
  useValidateCredentials,
  useConnectPaymentAccount,
  useDisconnectPaymentAccount,
  type PaymentAccountStatus,
} from './usePaymentAccount'
import api from '../api/client'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

const account: PaymentAccountStatus = {
  status: 'CONNECTED',
  provider: 'FLOW',
  displayName: 'Consulta',
  keyFingerprint: 'abcd',
  connectedAt: '2026-09-01T12:00:00Z',
  lastError: null,
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper, invalidate }
}

describe('usePaymentAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the account status', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: account })
    const { wrapper } = setup()

    const { result } = renderHook(() => usePaymentAccount(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/payments/account')
    expect(result.current.data).toEqual(account)
  })

  it('surfaces a network error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('Network Error'))
    const { wrapper } = setup()

    const { result } = renderHook(() => usePaymentAccount(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('validate posts credentials and does not invalidate the account', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { keyFingerprint: 'abcd' } })
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useValidateCredentials(), { wrapper })

    await act(() => result.current.mutateAsync({ apiKey: 'k', secretKey: 's' }))

    expect(mockedApi.post).toHaveBeenCalledWith('/payments/account/validate', {
      apiKey: 'k',
      secretKey: 's',
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('connect posts credentials and invalidates the account', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: account })
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useConnectPaymentAccount(), { wrapper })

    await act(() => result.current.mutateAsync({ apiKey: 'k', secretKey: 's' }))

    expect(mockedApi.post).toHaveBeenCalledWith('/payments/account', {
      apiKey: 'k',
      secretKey: 's',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payment-account'] })
  })

  it('connect does not invalidate when the request fails', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('invalid credentials'))
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useConnectPaymentAccount(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ apiKey: 'k', secretKey: 's' }),
      ).rejects.toThrow('invalid credentials')
    })

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('disconnect deletes the account and invalidates it', async () => {
    mockedApi.delete.mockResolvedValueOnce({ data: { status: 'DISCONNECTED' } })
    const { wrapper, invalidate } = setup()
    const { result } = renderHook(() => useDisconnectPaymentAccount(), { wrapper })

    await act(() => result.current.mutateAsync())

    expect(mockedApi.delete).toHaveBeenCalledWith('/payments/account')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payment-account'] })
  })
})

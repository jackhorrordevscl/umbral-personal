import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPaymentReturnStatus } from './payments'
import api from './client'

vi.mock('./client', () => ({
  default: { get: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('getPaymentReturnStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pide el estado con el token como query param y devuelve solo el status', async () => {
    mockedApi.get.mockResolvedValue({ data: { status: 'REJECTED' } })

    await expect(getPaymentReturnStatus('abc')).resolves.toBe('REJECTED')
    expect(mockedApi.get).toHaveBeenCalledWith('/payments/return-status', {
      params: { token: 'abc' },
    })
  })
})

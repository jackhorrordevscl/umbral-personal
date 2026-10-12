import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCreateConsultation } from './useConsultations'
import * as consultationsApi from '../api/consultations'

vi.mock('../api/consultations')

describe('useCreateConsultation (issue #445)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalida pacientes y descargos, porque reopenPatient reabre el tratamiento', async () => {
    vi.mocked(consultationsApi.createConsultation).mockResolvedValue({} as never)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useCreateConsultation(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ reopenPatient: true } as never)
    })
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey)
    expect(keys).toContainEqual(['patients'])
    expect(keys).toContainEqual(['discharges'])
    expect(keys).toContainEqual(['consultations'])
  })
})

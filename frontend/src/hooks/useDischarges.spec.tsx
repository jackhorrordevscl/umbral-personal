import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useCorrectDischarge,
  useCorrectUploadDischarge,
  useCreateDischargeDraft,
  useIssueDischarge,
  useUpdateDischarge,
  useUploadDischarge,
} from './useDischarges'
import '../api/discharges'

vi.mock('../api/discharges')

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const keys = () => invalidate.mock.calls.map((c) => c[0]?.queryKey)
  return { wrapper, keys }
}

const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })
const uploadData = { closureReason: 'DISCHARGED' as const, file }

// Issue #445: claves invalidadas por cada mutación del informe de alta.
describe('invalidaciones de useDischarges (issue #445)', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['useCreateDischargeDraft', () => useCreateDischargeDraft('p1'), { closureReason: 'DISCHARGED' }],
    ['useUpdateDischarge', () => useUpdateDischarge(), { id: 'd1', data: {} }],
  ])('%s invalida solo dischargeKeys.all', async (_name, hook, variables) => {
    const { wrapper, keys } = setup()
    const { result } = renderHook(hook as () => { mutateAsync: (v: unknown) => Promise<unknown> }, { wrapper })
    await act(async () => {
      await result.current.mutateAsync(variables)
    })
    expect(keys()).toEqual([['discharges']])
  })

  it('useCorrectDischarge invalida descargos, pacientes y documentos', async () => {
    const { wrapper, keys } = setup()
    const { result } = renderHook(() => useCorrectDischarge(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('d1')
    })
    expect(keys()).toEqual([['discharges'], ['patients'], ['patient-documents']])
  })

  it.each([
    ['useIssueDischarge', () => useIssueDischarge(), 'd1'],
    ['useUploadDischarge', () => useUploadDischarge('p1'), uploadData],
    ['useCorrectUploadDischarge', () => useCorrectUploadDischarge(), { id: 'd1', data: uploadData }],
  ])('%s (cierra el tratamiento) invalida agenda, disponibilidad y cobros', async (_n, hook, variables) => {
    const { wrapper, keys } = setup()
    const { result } = renderHook(hook as () => { mutateAsync: (v: unknown) => Promise<unknown> }, { wrapper })
    await act(async () => {
      await result.current.mutateAsync(variables)
    })
    expect(keys()).toEqual(
      expect.arrayContaining([
        ['discharges'],
        ['patients'],
        ['patient-documents'],
        ['consultations'],
        ['consultation-stats'],
        ['availability'],
        ['public-availability'],
        ['payment-account'],
      ]),
    )
  })
})

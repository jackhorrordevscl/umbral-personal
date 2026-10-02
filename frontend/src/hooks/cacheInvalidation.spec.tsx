import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUpdateProfile, type Profile } from './useProfile'
import { useEnableMfa, useDisableMfa } from './useMfa'
import { useCreatePatient, useUpdatePatient, useDeletePatient } from './usePatients'
import { useCreateConsultation, useCorrectConsultation } from './useConsultations'
import { useUploadPatientDocument } from './usePatientDocuments'
import api from '../api/client'
import * as patientsApi from '../api/patients'
import * as consultationsApi from '../api/consultations'
import * as documentsApi from '../api/documents'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('../api/patients')
vi.mock('../api/consultations')
vi.mock('../api/documents')

const mockedApi = vi.mocked(api)

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper, invalidate }
}

function invalidatedKeys(invalidate: ReturnType<typeof setup>['invalidate']) {
  return invalidate.mock.calls.map((c) => c[0]?.queryKey)
}

describe('cache invalidation (issue #292)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('useUpdateProfile merges the response into the profile cache', async () => {
    const { queryClient, wrapper, invalidate } = setup()
    queryClient.setQueryData(['profile'], { id: '1', name: 'Viejo', mfaEnabled: false } as Profile)
    mockedApi.patch.mockResolvedValue({ data: { name: 'Nuevo' } })

    const { result } = renderHook(() => useUpdateProfile(), { wrapper })
    await act(() => result.current.mutateAsync({ name: 'Nuevo' }))

    expect(queryClient.getQueryData<Profile>(['profile'])?.name).toBe('Nuevo')
    expect(invalidatedKeys(invalidate)).toContainEqual(['profile'])
  })

  it('useEnableMfa invalidates the profile', async () => {
    const { wrapper, invalidate } = setup()
    mockedApi.post.mockResolvedValue({ data: {} })

    const { result } = renderHook(() => useEnableMfa(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('123456')
    })

    expect(invalidatedKeys(invalidate)).toContainEqual(['profile'])
  })

  it('useDisableMfa invalidates the profile', async () => {
    const { wrapper, invalidate } = setup()
    mockedApi.post.mockResolvedValue({ data: {} })

    const { result } = renderHook(() => useDisableMfa(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('123456')
    })

    expect(invalidatedKeys(invalidate)).toContainEqual(['profile'])
  })

  it('useUpdatePatient invalidates the patient history', async () => {
    const { wrapper, invalidate } = setup()
    vi.mocked(patientsApi.updatePatient).mockResolvedValue({} as never)
    vi.mocked(patientsApi.getPatient).mockResolvedValue({ id: 'p1' } as never)

    const { result } = renderHook(() => useUpdatePatient(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ id: 'p1', data: { reason: 'x' }, consentChanges: [] }),
    )

    expect(invalidatedKeys(invalidate)).toContainEqual(['patient-history', 'p1'])
  })

  it('useCreatePatient invalidates the patients list and acquisition stats', async () => {
    const { wrapper, invalidate } = setup()
    vi.mocked(patientsApi.createPatient).mockResolvedValue({ id: 'p1' } as never)

    const { result } = renderHook(() => useCreatePatient(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ data: {} as never, consents: {} as never })
    })

    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(['patients'])
    expect(keys).toContainEqual(['acquisition-stats'])
  })

  it('useDeletePatient invalidates dashboard stats', async () => {
    const { wrapper, invalidate } = setup()
    vi.mocked(patientsApi.deletePatient).mockResolvedValue(undefined as never)

    const { result } = renderHook(() => useDeletePatient(), { wrapper })
    await act(() => result.current.mutateAsync('p1'))

    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(['acquisition-stats'])
    expect(keys).toContainEqual(['consultation-stats'])
  })

  it.each([
    ['useCreateConsultation', useCreateConsultation, () => vi.mocked(consultationsApi.createConsultation), {}],
    ['useCorrectConsultation', useCorrectConsultation, () => vi.mocked(consultationsApi.correctConsultation), { id: 'c1', data: {} }],
  ])('%s invalidates dashboard stats', async (_name, useHook, getApiMock, vars) => {
    const { wrapper, invalidate } = setup()
    getApiMock().mockResolvedValue({} as never)

    const { result } = renderHook(() => useHook(), { wrapper })
    await act(() => (result.current.mutateAsync as (v: unknown) => Promise<unknown>)(vars))

    const keys = invalidatedKeys(invalidate)
    expect(keys).toContainEqual(['consultation-stats'])
    expect(keys).toContainEqual(['acquisition-stats'])
  })

  it('useUploadPatientDocument invalidates the patients list', async () => {
    const { wrapper, invalidate } = setup()
    vi.mocked(documentsApi.uploadPatientDocument).mockResolvedValue({} as never)

    const { result } = renderHook(() => useUploadPatientDocument('p1'), { wrapper })
    await act(() =>
      result.current.mutateAsync({ file: new File(['x'], 'c.pdf'), type: 'CONSENT' }),
    )

    await waitFor(() => expect(invalidatedKeys(invalidate)).toContainEqual(['patients']))
  })
})

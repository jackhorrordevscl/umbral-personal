import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCalendarSessions } from './useCalendarSessions'
import api from '../api/client'
import type { CalendarSession } from '../api/consultations'

// PR4 (session-calendar-view, design.md "Data Flow" +
// "useCalendarSessions uses queryKey: ['consultations', 'range', from, to]"):
// el queryKey exacto es lo que hace que la invalidación existente de
// useCreateConsultation (queryKey: ['consultations']) refresque el grid del
// calendario sin wiring extra -- se testea explícitamente, no solo el fetch.

vi.mock('../api/client', () => ({
  default: { get: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildSession(overrides: Partial<CalendarSession> = {}): CalendarSession {
  return {
    id: 'c1',
    groupId: 'c1',
    sessionDate: '2026-09-10T13:00:00-03:00',
    sessionType: 'IN_PERSON',
    patientId: 'p1',
    patientName: 'Paciente Uno',
    calendarSync: null,
    ...overrides,
  }
}

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useCalendarSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pide el rango solicitado a /consultations/range y expone las sesiones devueltas', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [buildSession()] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(
      () => useCalendarSessions('2026-08-31T00:00:00-04:00', '2026-10-12T00:00:00-03:00'),
      { wrapper: makeWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(mockedApi.get).toHaveBeenCalledWith('/consultations/range', {
      params: { from: '2026-08-31T00:00:00-04:00', to: '2026-10-12T00:00:00-03:00' },
    })
    expect(result.current.data?.[0].patientName).toBe('Paciente Uno')
  })

  it("usa queryKey ['consultations','range',from,to], no otra forma -- de eso depende la invalidación de useCreateConsultation", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(
      () => useCalendarSessions('2026-08-31T00:00:00-04:00', '2026-10-12T00:00:00-03:00'),
      { wrapper: makeWrapper(queryClient) },
    )

    await waitFor(() =>
      expect(
        queryClient.getQueryData([
          'consultations',
          'range',
          '2026-08-31T00:00:00-04:00',
          '2026-10-12T00:00:00-03:00',
        ]),
      ).toEqual([]),
    )
  })
})

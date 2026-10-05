import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from './client'
import { getPatientsSummary, listPatients } from './patients'

vi.mock('./client', () => ({
  default: { get: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('api/patients (issue #290)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listPatients envía page, pageSize y search como query params y devuelve la página', async () => {
    const page = { data: [], total: 0, page: 2, pageSize: 10 }
    mockedApi.get.mockResolvedValue({ data: page })

    const result = await listPatients({ page: 2, pageSize: 10, search: '  ana ' })

    expect(mockedApi.get).toHaveBeenCalledWith('/patients', {
      params: { page: 2, pageSize: 10, search: 'ana' },
    })
    expect(result).toEqual(page)
  })

  it('listPatients omite search cuando está vacío o solo tiene espacios', async () => {
    mockedApi.get.mockResolvedValue({ data: { data: [], total: 0, page: 1, pageSize: 50 } })

    await listPatients({ search: '   ' })

    expect(mockedApi.get).toHaveBeenCalledWith('/patients', {
      params: { page: undefined, pageSize: undefined, search: undefined },
    })
  })

  it('getPatientsSummary consulta /patients/summary', async () => {
    mockedApi.get.mockResolvedValue({ data: { total: 4, withConsent: 3 } })

    await expect(getPatientsSummary()).resolves.toEqual({ total: 4, withConsent: 3 })
    expect(mockedApi.get).toHaveBeenCalledWith('/patients/summary')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from './client'
import {
  createGuardian,
  deleteGuardian,
  getPatientsSummary,
  listAssents,
  listGuardians,
  listPatients,
  recordAssent,
  recordPatientConsent,
  updateGuardian,
} from './patients'

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

  describe('bloque Menores', () => {
    it('recordPatientConsent no envía grantedBy ni guardianId para un adulto', async () => {
      mockedApi.post.mockResolvedValue({ data: {} })

      await recordPatientConsent('p1', 'TREATMENT', 'GRANT', 'Evidencia suficiente')

      expect(mockedApi.post).toHaveBeenCalledWith('/patients/p1/consents', {
        purpose: 'TREATMENT',
        action: 'GRANT',
        evidence: 'Evidencia suficiente',
      })
    })

    it('recordPatientConsent envía GUARDIAN y guardianId para el GRANT de un menor', async () => {
      mockedApi.post.mockResolvedValue({ data: {} })

      await recordPatientConsent('p1', 'TREATMENT', 'GRANT', 'Evidencia suficiente', {
        grantedBy: 'GUARDIAN',
        guardianId: 'g1',
      })

      expect(mockedApi.post).toHaveBeenCalledWith('/patients/p1/consents', {
        purpose: 'TREATMENT',
        action: 'GRANT',
        evidence: 'Evidencia suficiente',
        grantedBy: 'GUARDIAN',
        guardianId: 'g1',
      })
    })

    it('listGuardians consulta /patients/:id/guardians', async () => {
      mockedApi.get.mockResolvedValue({ data: [{ id: 'g1' }] })

      await expect(listGuardians('p1')).resolves.toEqual([{ id: 'g1' }])
      expect(mockedApi.get).toHaveBeenCalledWith('/patients/p1/guardians')
    })

    it('createGuardian, updateGuardian y deleteGuardian usan los verbos y rutas del backend', async () => {
      mockedApi.post.mockResolvedValue({ data: { id: 'g1' } })
      mockedApi.patch.mockResolvedValue({ data: { id: 'g1' } })
      mockedApi.delete.mockResolvedValue({ data: {} })
      const payload = { fullName: 'Ana Pérez', rut: '12345678-5', relationship: 'MOTHER' as const }

      await expect(createGuardian('p1', payload)).resolves.toEqual({ id: 'g1' })
      expect(mockedApi.post).toHaveBeenCalledWith('/patients/p1/guardians', payload)

      await updateGuardian('p1', 'g1', { isPayer: true })
      expect(mockedApi.patch).toHaveBeenCalledWith('/patients/p1/guardians/g1', { isPayer: true })

      await deleteGuardian('p1', 'g1')
      expect(mockedApi.delete).toHaveBeenCalledWith('/patients/p1/guardians/g1')
    })

    it('listAssents y recordAssent usan /patients/:id/assents', async () => {
      mockedApi.get.mockResolvedValue({ data: [{ id: 'a1' }] })
      mockedApi.post.mockResolvedValue({ data: { id: 'a2' } })

      await expect(listAssents('p1')).resolves.toEqual([{ id: 'a1' }])
      expect(mockedApi.get).toHaveBeenCalledWith('/patients/p1/assents')

      await expect(recordAssent('p1', { action: 'GRANTED', note: 'ok' })).resolves.toEqual({
        id: 'a2',
      })
      expect(mockedApi.post).toHaveBeenCalledWith('/patients/p1/assents', {
        action: 'GRANTED',
        note: 'ok',
      })
    })
  })
})

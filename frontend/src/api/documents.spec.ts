import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from './client'
import {
  listPatientDocuments,
  uploadPatientDocument,
  downloadDocument,
} from './documents'

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('documents api', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists documents of a patient', async () => {
    mockedApi.get.mockResolvedValue({ data: [{ id: 'd1' }] })
    await expect(listPatientDocuments('p1')).resolves.toEqual([{ id: 'd1' }])
    expect(mockedApi.get).toHaveBeenCalledWith('/documents/patient/p1')
  })

  it('uploads a document as multipart form data', async () => {
    mockedApi.post.mockResolvedValue({ data: {} })
    const file = new File(['x'], 'consent.pdf', { type: 'application/pdf' })
    await uploadPatientDocument('p1', file, 'INFORMED_CONSENT', 'g1')

    const [url, body, config] = mockedApi.post.mock.calls[0]
    expect(url).toBe('/documents/upload')
    const form = body as FormData
    expect(form.get('file')).toBe(file)
    expect(form.get('patientId')).toBe('p1')
    expect(form.get('type')).toBe('INFORMED_CONSENT')
    expect(form.get('consultationGroupId')).toBe('g1')
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } })
  })

  it('omits consultationGroupId when not provided', async () => {
    mockedApi.post.mockResolvedValue({ data: {} })
    await uploadPatientDocument('p1', new File(['x'], 'a.pdf'), 'OTHER')
    const form = mockedApi.post.mock.calls[0][1] as FormData
    expect(form.has('consultationGroupId')).toBe(false)
  })

  it('downloads a document as a blob', async () => {
    const blob = new Blob(['x'])
    mockedApi.get.mockResolvedValue({ data: blob })
    await expect(downloadDocument('d1')).resolves.toBe(blob)
    expect(mockedApi.get).toHaveBeenCalledWith('/documents/d1/download', {
      responseType: 'blob',
    })
  })
})

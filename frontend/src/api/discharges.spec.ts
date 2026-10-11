import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from './client'
import {
  correctDischarge,
  correctUploadDischarge,
  createDischargeDraft,
  downloadDischargePdf,
  getCancellationPreview,
  issueDischarge,
  listDischarges,
  updateDischarge,
  uploadDischarge,
  verifyDischarge,
} from './discharges'

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const mockedApi = vi.mocked(api)

describe('discharges api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockResolvedValue({ data: 'ok' })
    mockedApi.post.mockResolvedValue({ data: 'ok' })
    mockedApi.patch.mockResolvedValue({ data: 'ok' })
  })

  it('lists the versions of a patient', async () => {
    await listDischarges('p1')
    expect(mockedApi.get).toHaveBeenCalledWith('/patients/p1/discharges')
  })

  it('creates a draft with the closure fields', async () => {
    await createDischargeDraft('p1', { closureReason: 'REFERRED', referralDestination: 'Dra. Soto' })
    expect(mockedApi.post).toHaveBeenCalledWith('/patients/p1/discharges', {
      closureReason: 'REFERRED',
      referralDestination: 'Dra. Soto',
    })
  })

  it('reads the cancellation preview', async () => {
    await getCancellationPreview('p1')
    expect(mockedApi.get).toHaveBeenCalledWith('/patients/p1/discharges/cancellation-preview')
  })

  it('patches, issues and corrects by discharge id', async () => {
    await updateDischarge('d1', { sessionCount: 4 })
    expect(mockedApi.patch).toHaveBeenCalledWith('/discharges/d1', { sessionCount: 4 })
    await issueDischarge('d1')
    expect(mockedApi.post).toHaveBeenCalledWith('/discharges/d1/issue')
    await correctDischarge('d1')
    expect(mockedApi.post).toHaveBeenCalledWith('/discharges/d1/correct')
  })

  it('uploads a PDF as multipart with the closure fields', async () => {
    const file = new File(['%PDF-1.4'], 'alta.pdf', { type: 'application/pdf' })
    await uploadDischarge('p1', {
      file,
      closureReason: 'DROPPED_OUT',
      dropoutReason: 'COST',
      dischargeDate: '2026-10-10',
    })
    const [url, body, config] = mockedApi.post.mock.calls[0]
    expect(url).toBe('/patients/p1/discharges/upload')
    const form = body as FormData
    expect(form.get('file')).toBe(file)
    expect(form.get('closureReason')).toBe('DROPPED_OUT')
    expect(form.get('dropoutReason')).toBe('COST')
    expect(form.get('dischargeDate')).toBe('2026-10-10')
    expect(form.has('dropoutNote')).toBe(false)
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } })
  })

  it('uploads a replacement PDF to correct-upload', async () => {
    const file = new File(['%PDF-1.4'], 'alta.pdf', { type: 'application/pdf' })
    await correctUploadDischarge('d1', { file, closureReason: 'DISCHARGED' })
    expect(mockedApi.post.mock.calls[0][0]).toBe('/discharges/d1/correct-upload')
  })

  it('downloads the PDF as a blob and verifies', async () => {
    mockedApi.get.mockResolvedValue({ data: new Blob(['x']) })
    await downloadDischargePdf('d1')
    expect(mockedApi.get).toHaveBeenCalledWith('/discharges/d1/pdf', { responseType: 'blob' })
    await verifyDischarge('d1')
    expect(mockedApi.get).toHaveBeenCalledWith('/discharges/d1/verify')
  })
})

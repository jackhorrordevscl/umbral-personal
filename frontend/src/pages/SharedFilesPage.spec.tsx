import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SharedFilesPage from './SharedFilesPage'
import api from '../api/client'

// Issue #186: the upload dropzone was a <div onClick> with no role or key
// handling, unreachable with keyboard only. The real file input is hidden, so
// the dropzone itself must be focusable and open the file picker on Enter/Space.

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SharedFilesPage />
    </QueryClientProvider>,
  )
}

describe('SharedFilesPage — formularios y vista previa (#295)', () => {
  const sharedFile = (over: object) => ({
    id: 'f1',
    name: 'Plantilla',
    originalName: 'plantilla.docx',
    category: 'GENERAL',
    size: 1024,
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    createdAt: '2026-01-01T00:00:00.000Z',
    uploadedBy: { name: 'Ana' },
    ...over,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    window.URL.createObjectURL = vi.fn(() => 'blob:fake')
    window.URL.revokeObjectURL = vi.fn()
  })

  it('un archivo no previsualizable se descarga en vez de abrirse en una pestaña', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    mockedApi.get.mockImplementation((url: string) =>
      url.includes('/download')
        ? Promise.resolve({ data: new Blob(['x']) })
        : Promise.resolve({ data: [sharedFile({})] }),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByText('Plantilla'))

    await waitFor(() => expect(window.URL.revokeObjectURL).toHaveBeenCalled())
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('cancelar la subida reinicia el formulario', async () => {
    mockedApi.get.mockResolvedValue({ data: [] })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^subir archivo$/i }))
    await user.type(screen.getByLabelText(/nombre del archivo/i), 'Borrador')
    await user.click(screen.getByRole('button', { name: /cancelar/i }))
    await user.click(screen.getByRole('button', { name: /^subir archivo$/i }))

    expect(screen.getByLabelText(/nombre del archivo/i)).toHaveValue('')
  })

  it('rechaza en el cliente una extensión no admitida sin llamar a la API', async () => {
    mockedApi.get.mockResolvedValue({ data: [] })
    const user = userEvent.setup({ applyAccept: false })
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^subir archivo$/i }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'virus.exe', { type: 'application/octet-stream' }))
    await user.click(document.querySelector('button[type="submit"]') as HTMLButtonElement)

    expect(await screen.findByText(/formato no admitido/i)).toBeInTheDocument()
    expect(mockedApi.post).not.toHaveBeenCalled()
  })
})

describe('SharedFilesPage — upload dropzone keyboard access (#186)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.get.mockResolvedValue({ data: [] })
  })

  async function openUploadModal(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /^subir archivo$/i }))
    return screen.getByRole('button', { name: /seleccionar un archivo/i })
  }

  it.each(['{Enter}', ' '])('opens the file picker with %j on the focused dropzone', async (key) => {
    const user = userEvent.setup()
    renderPage()
    const dropzone = await openUploadModal(user)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')

    dropzone.focus()
    await user.keyboard(key)

    // The synthetic click bubbles back to the dropzone (browsers ignore the
    // re-entrant call), so assert "called", not an exact count.
    expect(clickSpy).toHaveBeenCalled()
  })

  it('is reachable via Tab', async () => {
    const user = userEvent.setup()
    renderPage()
    const dropzone = await openUploadModal(user)
    expect(dropzone).toHaveAttribute('tabindex', '0')
  })
})

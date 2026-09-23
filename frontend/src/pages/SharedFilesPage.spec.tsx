import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

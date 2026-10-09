import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../context/AuthContext'
import LoginPage from '../../pages/LoginPage'
import SignupPage from '../../pages/SignupPage'
import PublicBookingPage from '../../pages/PublicBookingPage'
import api from '../../api/client'
import { expectNoA11yViolations } from '../axe'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function TestProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  )
}

describe('a11y: public pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('LoginPage has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <TestProviders>
          <LoginPage />
        </TestProviders>
      </MemoryRouter>,
    )
    await screen.findByLabelText('Email')
    await expectNoA11yViolations(container)
  })

  it('SignupPage has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    )
    await screen.findByLabelText('Nombre completo')
    await expectNoA11yViolations(container)
  })

  it('PublicBookingPage has no axe violations once the profile and availability load', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.endsWith('/availability')) return Promise.resolve({ data: [] })
      if (url.endsWith('/profile')) {
        return Promise.resolve({
          data: { name: 'Ana Pérez', bio: 'Psicóloga clínica', specialty: 'Adultos', hasAvatar: false },
        })
      }
      return Promise.reject(new Error(`GET inesperado: ${url}`))
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/book/ana-perez']}>
          <Routes>
            <Route path="/book/:therapistId" element={<PublicBookingPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findAllByText('Ana Pérez')
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled())
    await expectNoA11yViolations(container)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationBell from './NotificationBell'
import api from '../../api/client'
import type { Notification } from '../../types/notification'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockedApi = vi.mocked(api)

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    userId: 'user-1',
    type: 'SESSION_REMINDER',
    title: 'Sesión en 24 horas',
    body: 'Tienes una sesión con Juan Pérez mañana a las 10:00.',
    linkPath: '/consultations',
    metadata: null,
    readAt: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    ...overrides,
  }
}

function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<NotificationBell />} />
          <Route path="/consultations" element={<p>Página de consultas</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el conteo de no leídas que devuelve el backend', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { count: 3 } })
      }
      return Promise.resolve({ data: [] })
    })

    renderBell()

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('3')
  })

  it('no muestra badge cuando no hay notificaciones sin leer', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { count: 0 } })
      }
      return Promise.resolve({ data: [] })
    })

    renderBell()

    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalledWith('/notifications/unread-count')
    })
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument()
  })

  it('abrir la campanita pide la lista y la muestra', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { count: 1 } })
      }
      if (url === '/notifications') {
        return Promise.resolve({ data: [buildNotification()] })
      }
      return Promise.resolve({ data: [] })
    })

    renderBell()
    await screen.findByTestId('notification-badge')

    await user.click(screen.getByRole('button', { name: /notificaciones/i }))

    expect(await screen.findByText('Sesión en 24 horas')).toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledWith('/notifications')
  })

  it('marcar una notificación como leída llama al PATCH y refresca el conteo del badge', async () => {
    const user = userEvent.setup()
    let unreadCount = 1
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { count: unreadCount } })
      }
      if (url === '/notifications') {
        return Promise.resolve({
          data: [buildNotification({ readAt: unreadCount === 0 ? new Date().toISOString() : null })],
        })
      }
      return Promise.resolve({ data: [] })
    })
    mockedApi.patch.mockImplementation(() => {
      unreadCount = 0
      return Promise.resolve({
        data: buildNotification({ readAt: new Date().toISOString() }),
      })
    })

    renderBell()
    await screen.findByTestId('notification-badge')

    await user.click(screen.getByRole('button', { name: /notificaciones/i }))
    const item = await screen.findByRole('button', { name: 'Sesión en 24 horas' })
    await user.click(item)

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith('/notifications/notif-1/read')
    })
    await waitFor(() => {
      expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument()
    })
  })

  it('click en una notificación con linkPath navega y cierra el panel', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { count: 1 } })
      }
      if (url === '/notifications') {
        return Promise.resolve({
          data: [buildNotification({ linkPath: '/consultations' })],
        })
      }
      return Promise.resolve({ data: [] })
    })
    mockedApi.patch.mockResolvedValue({
      data: buildNotification({ readAt: new Date().toISOString() }),
    })

    renderBell()
    await screen.findByTestId('notification-badge')

    await user.click(screen.getByRole('button', { name: /notificaciones/i }))
    await user.click(await screen.findByRole('button', { name: 'Sesión en 24 horas' }))

    expect(await screen.findByText('Página de consultas')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Notificaciones' })).not.toBeInTheDocument()
  })

  it('click en una notificación sin linkPath solo marca como leída, sin navegar', async () => {
    const user = userEvent.setup()
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { count: 1 } })
      }
      if (url === '/notifications') {
        return Promise.resolve({
          data: [buildNotification({ linkPath: null })],
        })
      }
      return Promise.resolve({ data: [] })
    })
    mockedApi.patch.mockResolvedValue({
      data: buildNotification({ readAt: new Date().toISOString() }),
    })

    renderBell()
    await screen.findByTestId('notification-badge')

    await user.click(screen.getByRole('button', { name: /notificaciones/i }))
    await user.click(await screen.findByRole('button', { name: 'Sesión en 24 horas' }))

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith('/notifications/notif-1/read')
    })
    expect(screen.queryByText('Página de consultas')).not.toBeInTheDocument()
  })
})

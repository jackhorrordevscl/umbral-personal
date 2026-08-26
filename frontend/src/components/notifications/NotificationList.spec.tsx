import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotificationList from './NotificationList'
import type { Notification } from '../../types/notification'

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

function renderList(overrides: Partial<React.ComponentProps<typeof NotificationList>> = {}) {
  const props = {
    notifications: [buildNotification()],
    isLoading: false,
    isError: false,
    onMarkRead: vi.fn(),
    ...overrides,
  }
  render(<NotificationList {...props} />)
  return props
}

describe('NotificationList', () => {
  it('muestra el estado de carga', () => {
    renderList({ isLoading: true, notifications: [] })

    expect(screen.getByText(/cargando notificaciones/i)).toBeInTheDocument()
  })

  it('muestra un mensaje de error si la carga falló', () => {
    renderList({ isError: true, notifications: [] })

    expect(
      screen.getByText(/no se pudieron cargar las notificaciones/i),
    ).toBeInTheDocument()
  })

  it('muestra un estado vacío cuando no hay notificaciones', () => {
    renderList({ notifications: [] })

    expect(screen.getByText(/no tienes notificaciones/i)).toBeInTheDocument()
  })

  it('lista las notificaciones recibidas', () => {
    renderList({
      notifications: [
        buildNotification({ id: 'a', title: 'Sesión en 24 horas' }),
        buildNotification({ id: 'b', title: 'Sesión en 2 horas', readAt: '2026-08-24T09:00:00.000Z' }),
      ],
    })

    expect(screen.getByText('Sesión en 24 horas')).toBeInTheDocument()
    expect(screen.getByText('Sesión en 2 horas')).toBeInTheDocument()
  })

  it('click en una notificación no leída llama a onMarkRead con su id', async () => {
    const user = userEvent.setup()
    const props = renderList({
      notifications: [buildNotification({ id: 'notif-1', readAt: null })],
    })

    await user.click(screen.getByRole('button', { name: /marcar como leída/i }))

    expect(props.onMarkRead).toHaveBeenCalledWith('notif-1')
  })

  it('click en una notificación ya leída no llama a onMarkRead', async () => {
    const user = userEvent.setup()
    const props = renderList({
      notifications: [
        buildNotification({ id: 'notif-1', title: 'Ya leída', readAt: '2026-08-24T09:00:00.000Z' }),
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Ya leída' }))

    expect(props.onMarkRead).not.toHaveBeenCalled()
  })
})

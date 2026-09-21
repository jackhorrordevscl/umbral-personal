import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReminderEmailStatusBadge from './ReminderEmailStatusBadge'
import type { ReminderEmailStatus } from '../../types/patient'

function buildStatus(overrides: Partial<ReminderEmailStatus> = {}): ReminderEmailStatus {
  return {
    status: 'SENT',
    deliveredAt: null,
    openedAt: null,
    ...overrides,
  }
}

// issue #163: cada estado del último ReminderDispatch EMAIL de la sesión
// debe mapear a lo sumo un chip visible; sin dispatch asociado, o en un
// estado transitorio/no-op del dispatcher (PENDING/SKIPPED), no debe
// renderizar nada.
describe('ReminderEmailStatusBadge', () => {
  it('no renderiza nada cuando nunca se despachó un recordatorio por email', () => {
    const { container } = render(<ReminderEmailStatusBadge status={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('no renderiza nada para un dispatch PENDING', () => {
    const { container } = render(
      <ReminderEmailStatusBadge status={buildStatus({ status: 'PENDING' })} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('no renderiza nada para un dispatch SKIPPED', () => {
    const { container } = render(
      <ReminderEmailStatusBadge status={buildStatus({ status: 'SKIPPED' })} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza "Recordatorio no enviado" para un dispatch FAILED', () => {
    render(<ReminderEmailStatusBadge status={buildStatus({ status: 'FAILED' })} />)

    expect(screen.getByText('Recordatorio no enviado')).toBeInTheDocument()
  })

  it('renderiza "Recordatorio enviado" para SENT sin deliveredAt', () => {
    render(<ReminderEmailStatusBadge status={buildStatus({ status: 'SENT' })} />)

    expect(screen.getByText('Recordatorio enviado')).toBeInTheDocument()
  })

  it('renderiza "Entregado" cuando hay deliveredAt sin openedAt', () => {
    render(
      <ReminderEmailStatusBadge
        status={buildStatus({ status: 'SENT', deliveredAt: '2026-09-20T10:00:00.000Z' })}
      />,
    )

    expect(screen.getByText('Entregado')).toBeInTheDocument()
  })

  it('renderiza "Abierto" cuando hay openedAt', () => {
    render(
      <ReminderEmailStatusBadge
        status={buildStatus({
          status: 'SENT',
          deliveredAt: '2026-09-20T10:00:00.000Z',
          openedAt: '2026-09-20T11:00:00.000Z',
        })}
      />,
    )

    expect(screen.getByText('Abierto')).toBeInTheDocument()
  })
})

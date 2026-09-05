import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PaymentStatusBadge from './PaymentStatusBadge'
import type { PaymentSummary } from '../../types/patient'

function buildPayment(overrides: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    groupId: 'group-1',
    status: 'PENDING',
    linkDelivery: 'SENT',
    paymentUrl: 'https://flow.cl/pay/token-1',
    amount: 30000,
    ...overrides,
  }
}

// sdd/online-payment-integration PR 3 (T10.5): cada status + el estado
// SKIPPED_NO_EMAIL (link no entregado, design.md "therapist-visible link
// not delivered state") deben renderizar una etiqueta visible y distinta;
// sin cargo asociado, el badge no debe renderizar nada.
describe('PaymentStatusBadge', () => {
  it('no renderiza nada cuando no hay cargo asociado a la sesión', () => {
    const { container } = render(<PaymentStatusBadge payment={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza "Cobro pendiente" para un cargo PENDING con link entregado', () => {
    render(<PaymentStatusBadge payment={buildPayment({ status: 'PENDING', linkDelivery: 'SENT' })} />)

    expect(screen.getByText('Cobro pendiente')).toBeInTheDocument()
  })

  it('renderiza "Link no enviado" para un cargo PENDING con linkDelivery=SKIPPED_NO_EMAIL', () => {
    render(
      <PaymentStatusBadge
        payment={buildPayment({ status: 'PENDING', linkDelivery: 'SKIPPED_NO_EMAIL' })}
      />,
    )

    expect(screen.getByText('Link no enviado')).toBeInTheDocument()
  })

  it('renderiza "Pagado" para un cargo PAID', () => {
    render(<PaymentStatusBadge payment={buildPayment({ status: 'PAID' })} />)

    expect(screen.getByText('Pagado')).toBeInTheDocument()
  })

  it('renderiza "Cobro atrasado" para un cargo LATE', () => {
    render(<PaymentStatusBadge payment={buildPayment({ status: 'LATE' })} />)

    expect(screen.getByText('Cobro atrasado')).toBeInTheDocument()
  })

  it('renderiza "Cobro cancelado" para un cargo CANCELLED', () => {
    render(<PaymentStatusBadge payment={buildPayment({ status: 'CANCELLED' })} />)

    expect(screen.getByText('Cobro cancelado')).toBeInTheDocument()
  })
})

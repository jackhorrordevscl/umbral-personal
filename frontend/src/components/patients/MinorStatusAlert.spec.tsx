import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MinorStatusAlert from './MinorStatusAlert'

describe('MinorStatusAlert', () => {
  it('avisa la falta de representante con el plazo del 01-12-2026', () => {
    render(<MinorStatusAlert minorStatus="MISSING_GUARDIAN" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/no tiene un representante legal/i)
    expect(alert).toHaveTextContent(/01-12-2026/)
  })

  it('avisa el consentimiento legado con el plazo recibido del backend', () => {
    render(<MinorStatusAlert minorStatus="LEGACY_CONSENT" enforcementDate="2027-03-05" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/otorgado por él mismo/i)
    expect(alert).toHaveTextContent(/05-03-2027/)
  })

  it.each(['OK', 'NOT_MINOR'] as const)('no renderiza nada con %s', (status) => {
    const { container } = render(<MinorStatusAlert minorStatus={status} />)
    expect(container).toBeEmptyDOMElement()
  })
})

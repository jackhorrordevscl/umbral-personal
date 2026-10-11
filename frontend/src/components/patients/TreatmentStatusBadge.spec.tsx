import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TreatmentStatusBadge from './TreatmentStatusBadge'

describe('TreatmentStatusBadge', () => {
  it.each([
    ['ACTIVE', 'En tratamiento'],
    ['DISCHARGED', 'Alta'],
    ['REFERRED', 'Derivado'],
    ['DROPPED_OUT', 'Deserción'],
  ] as const)('muestra %s como "%s"', (status, label) => {
    render(<TreatmentStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('no renderiza nada sin estado', () => {
    const { container } = render(<TreatmentStatusBadge />)
    expect(container).toBeEmptyDOMElement()
  })
})

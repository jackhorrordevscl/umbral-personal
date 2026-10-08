import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgeBandBadge from './AgeBandBadge'

describe('AgeBandBadge', () => {
  it('muestra el tramo de un menor de 14', () => {
    render(<AgeBandBadge ageBand="UNDER_14" />)
    expect(screen.getByText('Menor de 14 años')).toBeInTheDocument()
  })

  it('muestra el tramo de 14 a 17', () => {
    render(<AgeBandBadge ageBand="AGE_14_17" />)
    expect(screen.getByText('Adolescente de 14 a 17 años')).toBeInTheDocument()
  })

  it('no renderiza nada para un adulto ni sin tramo', () => {
    const { container, rerender } = render(<AgeBandBadge ageBand="ADULT" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<AgeBandBadge />)
    expect(container).toBeEmptyDOMElement()
  })
})

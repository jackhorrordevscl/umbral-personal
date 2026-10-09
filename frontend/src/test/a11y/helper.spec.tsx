import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { expectNoA11yViolations } from '../axe'

describe('expectNoA11yViolations', () => {
  it('passes on accessible markup', async () => {
    const { container } = render(<img src="x.png" alt="Logo" />)
    await expect(expectNoA11yViolations(container)).resolves.toBeUndefined()
  })

  it('throws listing rule id, impact and offending HTML for a violation', async () => {
    const { container } = render(<img src="x.png" />)
    await expect(expectNoA11yViolations(container)).rejects.toThrow(
      /\[image-alt\] \(critical\)[\s\S]*<img src="x\.png">/,
    )
  })
})

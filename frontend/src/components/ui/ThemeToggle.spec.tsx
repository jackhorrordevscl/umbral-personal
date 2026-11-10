import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeToggle from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    localStorage.clear()
  })

  it('arranca en claro y ofrece cambiar a modo oscuro', () => {
    render(<ThemeToggle />)
    expect(
      screen.getByRole('button', { name: 'Cambiar a modo oscuro' }),
    ).toBeInTheDocument()
  })

  it('al hacer clic pasa a oscuro, persiste la elección y cambia la etiqueta', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Cambiar a modo oscuro' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('umbral-theme')).toBe('dark')
    expect(
      screen.getByRole('button', { name: 'Cambiar a modo claro' }),
    ).toBeInTheDocument()
  })

  it('la variante de la barra lateral muestra el texto de la acción', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle variant="sidebar" />)
    expect(screen.getByText('Modo oscuro')).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('Modo claro')).toBeInTheDocument()
  })
})

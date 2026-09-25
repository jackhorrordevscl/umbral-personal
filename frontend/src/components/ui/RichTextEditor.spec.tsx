import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RichTextEditor from './RichTextEditor'

describe('RichTextEditor', () => {
  it('renderiza el HTML inicial y expone un textbox accesible por nombre', async () => {
    render(
      <RichTextEditor
        value="<p>Contenido inicial</p>"
        onChange={vi.fn()}
        ariaLabel="Motivo de consulta"
      />,
    )

    const textbox = await screen.findByRole('textbox', { name: 'Motivo de consulta' })
    expect(textbox).toHaveTextContent('Contenido inicial')
  })

  it('llama a onChange con el HTML resultante al aplicar negrita y escribir', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<RichTextEditor value="" onChange={onChange} ariaLabel="Motivo de consulta" />)

    const textbox = await screen.findByRole('textbox', { name: 'Motivo de consulta' })
    await user.click(textbox)
    await user.type(textbox, 'Hola')

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
    const lastCallHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string
    expect(lastCallHtml).toContain('Hola')

    await user.click(screen.getByRole('button', { name: 'Negrita' }))
    expect(screen.getByRole('button', { name: 'Negrita' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('emite <u> al aplicar subrayado y marca el botón como activo', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<RichTextEditor value="" onChange={onChange} ariaLabel="Motivo de consulta" />)

    const textbox = await screen.findByRole('textbox', { name: 'Motivo de consulta' })
    await user.click(textbox)
    await user.click(screen.getByRole('button', { name: 'Subrayado' }))
    await user.type(textbox, 'Hola')

    expect(screen.getByRole('button', { name: 'Subrayado' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      const lastCallHtml = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string
      expect(lastCallHtml).toContain('<u>Hola</u>')
    })
  })

  it('resincroniza el contenido cuando cambia value desde afuera', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <RichTextEditor value="<p>uno</p>" onChange={onChange} ariaLabel="Motivo de consulta" />,
    )

    const textbox = await screen.findByRole('textbox', { name: 'Motivo de consulta' })
    expect(textbox).toHaveTextContent('uno')

    rerender(<RichTextEditor value="<p>dos</p>" onChange={onChange} ariaLabel="Motivo de consulta" />)

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Motivo de consulta' })).toHaveTextContent('dos')
    })
  })
})

import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PasswordInput from './PasswordInput';

describe('PasswordInput', () => {
  it('oculta la contraseña por defecto', () => {
    render(<PasswordInput aria-label="Clave" />);
    expect(screen.getByLabelText('Clave')).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('alterna la visibilidad y actualiza aria-label y aria-pressed', () => {
    render(<PasswordInput aria-label="Clave" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(screen.getByLabelText('Clave')).toHaveAttribute('type', 'text');
    const toggle = screen.getByRole('button', { name: 'Ocultar contraseña' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(screen.getByLabelText('Clave')).toHaveAttribute('type', 'password');
    expect(
      screen.getByRole('button', { name: 'Mostrar contraseña' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('reenvía el ref y las props estándar al input', () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(
      <PasswordInput
        ref={ref}
        id="pw"
        className="custom-class"
        placeholder="Tu clave"
        autoComplete="new-password"
        aria-label="Clave"
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('Clave');
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('id', 'pw');
    expect(input).toHaveAttribute('placeholder', 'Tu clave');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveClass('custom-class');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('el botón no envía el formulario', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Clave" />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

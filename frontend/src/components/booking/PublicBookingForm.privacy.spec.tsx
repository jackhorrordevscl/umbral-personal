import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicBookingForm from './PublicBookingForm';

// Nota de privacidad junto al formulario de reserva (rediseno-agenda-publica
// PR4, spec "Privacy Note Next to the Booking Form"). Vive en un spec aparte
// porque PublicBookingForm.spec.tsx esta congelado.

vi.mock('../../api/client', () => ({
  default: { post: vi.fn() },
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PublicBookingForm
        therapistId="therapist-1"
        slotStart="2026-09-20T13:00:00.000Z"
        onSuccess={vi.fn()}
        onSlotTaken={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('PublicBookingForm: nota de privacidad', () => {
  it('muestra la nota con el texto aprobado', () => {
    renderForm();
    const note = screen.getByTestId('booking-privacy-note');
    expect(note).toHaveTextContent(
      'Privacidad. Usamos los datos que ingresas (los tuyos o, si reservas por un menor, los del paciente y los de su representante legal: nombre, RUT, fecha de nacimiento y correo) solo para gestionar la reserva y la atención. Los recibe tu terapeuta. Más información en nuestra política de privacidad.',
    );
  });

  it('mantiene una sola nota, la misma, al reservar por un menor', async () => {
    renderForm();
    const before = screen.getByTestId('booking-privacy-note').textContent;
    await userEvent.setup().click(
      screen.getByLabelText('Reservo para un menor de edad'),
    );
    const notes = screen.getAllByTestId('booking-privacy-note');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe(before);
  });

  it('no afirma quién es el responsable del tratamiento', () => {
    renderForm();
    const note = screen.getByTestId('booking-privacy-note');
    expect(note).not.toHaveTextContent(/quien los trata|responsable/i);
  });

  it('no repite el titulo "Tus datos" dentro de la nota', () => {
    renderForm();
    expect(screen.getAllByText('Tus datos')).toHaveLength(1);
  });

  it('queda antes del boton de confirmar en el orden del DOM', () => {
    renderForm();
    const note = screen.getByTestId('booking-privacy-note');
    const submit = screen.getByRole('button', { name: 'Confirmar reserva' });
    expect(
      note.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('enlaza a la politica de privacidad externa en una pestana nueva', () => {
    renderForm();
    const link = screen.getByRole('link', { name: 'política de privacidad' });
    expect(link).toHaveAttribute(
      'href',
      'https://umbral.groundzerodevs.com/privacidad-general',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('no afirma retencion, cifrado ni terceros', () => {
    renderForm();
    const text = screen.getByTestId('booking-privacy-note').textContent ?? '';
    expect(text).not.toMatch(
      /cifrad|encript|retenemos|conserv|almacen|terceros/i,
    );
  });

  it('no altera las etiquetas ni el boton de confirmar', () => {
    renderForm();
    expect(screen.getByLabelText(/nombre completo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rut/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fecha de nacimiento/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirmar reserva' }),
    ).toBeEnabled();
  });
});

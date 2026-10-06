import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingConfirmation from './BookingConfirmation';
import { formatChileDate } from '../../utils/datetime';

vi.mock('../../utils/datetime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/datetime')>();
  return { ...actual, formatChileDate: vi.fn(actual.formatChileDate) };
});

const SESSION_DATE = '2026-10-08T14:00:00.000Z';
const NO_CHECKOUT = { pending: false, url: null, pollExhausted: false };

function renderBooked(checkout: {
  pending: boolean;
  url: string | null;
  pollExhausted: boolean;
}) {
  return render(
    <BookingConfirmation
      variant="booked"
      sessionDate={SESSION_DATE}
      checkout={checkout}
    />,
  );
}

describe('BookingConfirmation', () => {
  afterEach(() => {
    vi.mocked(formatChileDate).mockRestore();
  });

  it('termina la frase de la fecha con un solo punto cuando el formato ya lo trae (p. m.)', () => {
    renderBooked(NO_CHECKOUT);

    const sentence = screen.getByText(/Tu sesión quedó agendada para el/);
    expect(sentence.textContent).not.toContain('..');
    expect(sentence.textContent).toMatch(/[^.]\.$/);
  });

  it('agrega el punto final cuando la fecha formateada no termina en punto', () => {
    vi.mocked(formatChileDate).mockReturnValue('8 de octubre de 2026, 11:00');
    renderBooked(NO_CHECKOUT);

    expect(
      screen.getByText(
        'Tu sesión quedó agendada para el 8 de octubre de 2026, 11:00.',
      ),
    ).toBeInTheDocument();
  });

  it('muestra solo el exito cuando no hay checkout', () => {
    renderBooked(NO_CHECKOUT);

    expect(
      screen.getByRole('heading', { name: '¡Listo!' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Tu sesión quedó agendada para el ${formatChileDate(SESSION_DATE).replace(/\.$/, '')}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
  });

  it('avisa que prepara el pago mientras el checkout esta pendiente sin URL', () => {
    renderBooked({ pending: true, url: null, pollExhausted: false });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Preparando tu pago...',
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('ofrece el link de pago cuando ya hay URL', () => {
    renderBooked({
      pending: true,
      url: 'https://flow.example/pay/abc',
      pollExhausted: false,
    });

    expect(
      screen.getByText('Vas a salir de esta página para completar el pago.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pagar ahora' })).toHaveAttribute(
      'href',
      'https://flow.example/pay/abc',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('indica que el link llegara por email cuando se agota el polling', () => {
    renderBooked({ pending: true, url: null, pollExhausted: true });

    expect(
      screen.getByText('Te vamos a enviar el link de pago a tu email.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('no muestra datos de pago si el checkout no esta pendiente aunque haya URL', () => {
    renderBooked({
      pending: false,
      url: 'https://flow.example/pay/abc',
      pollExhausted: true,
    });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/pago/i)).not.toBeInTheDocument();
  });

  it('en el retorno de Flow no muestra link ni afirma un email de confirmacion', () => {
    render(<BookingConfirmation variant="flowReturn" />);

    expect(
      screen.getByRole('heading', { name: '¡Listo!' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tu sesión ya está agendada. Si el pago quedó pendiente, tu terapeuta te lo confirmará por email.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('enfoca el heading al montar', () => {
    renderBooked(NO_CHECKOUT);

    const heading = screen.getByRole('heading', { name: '¡Listo!' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading).toHaveFocus();
  });

  it('usa la tarjeta sobre fondo crema', () => {
    const { container } = render(<BookingConfirmation variant="flowReturn" />);

    expect(container.firstElementChild).toHaveClass(
      'min-h-screen',
      'bg-cream-100',
    );
    expect(container.querySelector('.card')).toBeInTheDocument();
  });
});

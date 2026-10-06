import { useEffect, useRef } from 'react';
import { formatChileDate } from '../../utils/datetime';

type BookingConfirmationProps =
  | {
      variant: 'booked';
      sessionDate: string;
      checkout: {
        pending: boolean;
        url: string | null;
        pollExhausted: boolean;
      };
    }
  | { variant: 'flowReturn' };

// Confirmación unificada de la reserva pública (design.md, BookingConfirmation).
// Pura: el polling del checkout vive en la página y llega por props. El backend
// no envía un email de confirmación de la reserva, así que el único texto que
// menciona un email es el del link de pago cuando el polling se agota.
export default function BookingConfirmation(props: BookingConfirmationProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // La confirmación reemplaza toda la vista: el foco va al heading para que
  // teclado y lector de pantalla no queden en un botón que ya no existe.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center p-6">
      <div className="card w-full max-w-md text-center p-8">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl text-slate-900 mb-2 outline-none"
        >
          ¡Listo!
        </h2>
        {props.variant === 'flowReturn' ? (
          <p className="text-slate-600 text-sm">
            Tu sesión ya está agendada. Si el pago quedó pendiente, tu terapeuta
            te lo confirmará por email.
          </p>
        ) : (
          <>
            <p className="text-slate-600 text-sm">
              Tu sesión quedó agendada para el{' '}
              {formatChileDate(props.sessionDate)}.
            </p>
            {props.checkout.pending && props.checkout.url && (
              <div className="mt-4">
                <p className="text-slate-500 text-xs mb-2">
                  Vas a salir de esta página para completar el pago.
                </p>
                <a
                  href={props.checkout.url}
                  className="btn-primary inline-flex min-h-11 items-center"
                >
                  Pagar ahora
                </a>
              </div>
            )}
            {props.checkout.pending &&
              !props.checkout.url &&
              !props.checkout.pollExhausted && (
                <p className="text-slate-500 text-xs mt-4" role="status">
                  Preparando tu pago...
                </p>
              )}
            {props.checkout.pending &&
              !props.checkout.url &&
              props.checkout.pollExhausted && (
                <p className="text-slate-500 text-xs mt-4">
                  Te vamos a enviar el link de pago a tu email.
                </p>
              )}
          </>
        )}
      </div>
    </div>
  );
}

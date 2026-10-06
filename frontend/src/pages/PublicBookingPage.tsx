import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import BookingCalendar from '../components/booking/BookingCalendar';
import ProfileCard from '../components/booking/ProfileCard';
import PublicBookingForm from '../components/booking/PublicBookingForm';
import SlotList from '../components/booking/SlotList';
import ErrorBanner from '../components/ui/ErrorBanner';
import { usePublicAvailability, usePublicTherapistProfile } from '../hooks/usePublicScheduling';
import { getBookingCheckout, getPublicTherapistAvatarUrl } from '../api/publicScheduling';
import {
  chileMonthGridRange,
  formatChileDate,
  groupSlotsByChileDay,
  toChileDayKey,
} from '../utils/datetime';
import { addMonths, chileTodayViewMonth } from '../utils/booking-calendar';
import { revealElement } from '../utils/reveal';
import type { ViewMonth } from '../utils/booking-calendar';
import type { BookingConfirmation, PublicBookingOrigin, PublicSlot } from '../api/publicScheduling';

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.4, design.md
// Decision 5 "Checkout is polled, not awaited"): ensureCharge() es
// fire-and-forget en el backend, así que paymentUrl casi nunca existe
// todavía cuando book() responde. Constantes nombradas a propósito (design.md
// Open Questions: "Poll budget and interval... proposed: 2s / ~15s") para que
// una PR futura pueda ajustar el presupuesto sin tocar la lógica de polling.
export const CHECKOUT_POLL_INTERVAL_MS = 2000;
export const CHECKOUT_POLL_TIMEOUT_MS = 15000;

// sdd/patient-self-scheduling PR 5 (tasks.md 5.2, public-scheduling Req:
// "Public Availability Read Endpoint" + "Double-Booking Protection"): página
// pública SIN AuthProvider/JWT -- solo lee useParams de react-router, ningún
// hook de auth, ninguna dependencia de sesión. Reutiliza el mismo patrón
// mes-a-mes que CalendarPage (chileMonthGridRange + addMonths) pero con
// celdas propias en vez de MonthGrid/DayCell, que están acopladas a
// CalendarSession del módulo autenticado de calendario (design.md "no
// duplicar" se resuelve reusando los helpers de fecha, no el componente
// visual, que pertenece a un dominio distinto).
export default function PublicBookingPage() {
  const { therapistId = '' } = useParams<{ therapistId: string }>();
  const [searchParams] = useSearchParams();
  // issue #155: la query vive en la página para saber si hay perfil y elegir
  // el layout (dos columnas o ancho completo) sin dejar una columna vacía.
  // Carga o error equivalen a "sin perfil": nunca bloquea ni muestra un error
  // que compita con el flujo de reserva (el perfil es puramente decorativo).
  // React Query deduplica, así que no agrega requests.
  const { data: profile } = usePublicTherapistProfile(therapistId);
  const [viewMonth, setViewMonth] = useState<ViewMonth>(chileTodayViewMonth);
  // "Hoy" se fija una sola vez al montar y se inyecta al calendario, que queda
  // puro y testeable con fechas fijas (mismo criterio America/Santiago).
  const [todayKey] = useState(() => toChileDayKey(new Date().toISOString()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [takenMessage, setTakenMessage] = useState('');
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutPollExhausted, setCheckoutPollExhausted] = useState(false);
  const slotsRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLElement>(null);

  // issue #157: derivado UNA sola vez al montar (lazy initializer) -- ni
  // utm_source (query string en el momento de la carga) ni document.referrer
  // (el referrer que trajo a este visitante) cambian durante la sesión de
  // reserva, así que recalcularlo en cada render no tiene sentido y además
  // podría perder el referrer real si el usuario navega dentro de la propia
  // SPA. source?/referrer? ausentes ⇒ undefined completo (nunca un objeto
  // vacío) para que el backend lo trate igual que "sin origin en el payload".
  const [origin] = useState<PublicBookingOrigin | undefined>(() => {
    const source = searchParams.get('utm_source') ?? undefined;
    const referrer = document.referrer || undefined;
    if (!source && !referrer) return undefined;
    return { source, referrer };
  });

  const changeMonth = (delta: number) => {
    setViewMonth((prev) => addMonths(prev, delta));
    setSelectedDay(null);
    setSelectedSlot(null);
    setTakenMessage('');
  };

  const grid = useMemo(
    () => chileMonthGridRange(viewMonth.year, viewMonth.month),
    [viewMonth],
  );
  const {
    data: slots = [],
    isLoading,
    isError,
    refetch,
  } = usePublicAvailability(therapistId, grid.from, grid.to);
  const slotsByDay = useMemo(() => groupSlotsByChileDay(slots), [slots]);

  // Scroll guiado sin mover el foco (design.md Decision 6): el efecto (y no el
  // handler) porque la sección recién existe en el render posterior al cambio
  // de estado; el guard evita desplazar la vista al montar.
  useEffect(() => {
    if (selectedDay) revealElement(slotsRef.current);
  }, [selectedDay]);
  useEffect(() => {
    if (selectedSlot) revealElement(formRef.current);
  }, [selectedSlot]);

  // design.md Data Flow "unique violation ⇒ 409 (client refetches)": el
  // visitante nunca ve por qué (spec.md "never discloses why") -- solo que
  // ese horario ya no está libre, y la disponibilidad se refresca para que
  // vea el estado real antes de reintentar.
  const handleSlotTaken = () => {
    setSelectedSlot(null);
    setTakenMessage('Ese horario ya no está disponible. Elige otro horario libre.');
    refetch();
  };

  // tasks.md 5.4, design.md Decision 5: pollea GET .../checkout cada
  // CHECKOUT_POLL_INTERVAL_MS hasta que aparezca un paymentUrl o se agote
  // CHECKOUT_POLL_TIMEOUT_MS. Solo arranca cuando checkout.status === 'PENDING'
  // -- NOT_APPLICABLE o ausente (flag apagado en el backend) nunca dispara un
  // solo request de polling.
  useEffect(() => {
    if (!confirmation || confirmation.checkout?.status !== 'PENDING') {
      return;
    }
    let cancelled = false;
    let elapsedMs = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const result = await getBookingCheckout(therapistId, confirmation.groupId);
        if (cancelled) return;
        if (result.paymentUrl) {
          setCheckoutUrl(result.paymentUrl);
          return;
        }
      } catch {
        // Un error de red durante el polling no debe interrumpir la
        // confirmación de reserva -- ya exitosa e independiente del pago --
        // simplemente se reintenta en el próximo tick o se agota el
        // presupuesto igual que si el backend respondiera sin paymentUrl.
      }
      if (cancelled) return;
      elapsedMs += CHECKOUT_POLL_INTERVAL_MS;
      if (elapsedMs >= CHECKOUT_POLL_TIMEOUT_MS) {
        setCheckoutPollExhausted(true);
        return;
      }
      timeoutId = setTimeout(poll, CHECKOUT_POLL_INTERVAL_MS);
    };

    timeoutId = setTimeout(poll, CHECKOUT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [confirmation, therapistId]);

  if (confirmation) {
    const checkoutStatus = confirmation.checkout?.status;
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center p-8">
        <div className="card w-full max-w-md text-center p-8">
          <h2 className="font-display text-2xl text-slate-900 mb-2">¡Listo!</h2>
          <p className="text-slate-500 text-sm">
            Tu sesión quedó agendada para el {formatChileDate(confirmation.sessionDate)}.
          </p>
          {checkoutStatus === 'PENDING' && checkoutUrl && (
            <div className="mt-4">
              <p className="text-slate-500 text-xs mb-2">
                Vas a salir de esta página para completar el pago.
              </p>
              <a href={checkoutUrl} className="btn-primary inline-block">
                Pagar ahora
              </a>
            </div>
          )}
          {checkoutStatus === 'PENDING' && !checkoutUrl && !checkoutPollExhausted && (
            <p className="text-slate-500 text-xs mt-4" role="status">
              Preparando tu pago...
            </p>
          )}
          {checkoutStatus === 'PENDING' && !checkoutUrl && checkoutPollExhausted && (
            <p className="text-slate-500 text-xs mt-4">
              Te vamos a enviar el link de pago a tu email.
            </p>
          )}
        </div>
      </div>
    );
  }

  // tasks.md 5.5, spec.md "Flow return arrival displays confirmation state,
  // not payment status": fallback defensivo -- el retorno real de Flow NUNCA
  // apunta acá (design.md Decision 2: PaymentsController sigue
  // redirigiendo a /pago-recibido, PaymentReturnPage.tsx), pero si un link
  // viejo/stale trae a alguien de todos modos con ?flow_return=1 y esta
  // página se monta sin un `confirmation` local (visitante nuevo en esta
  // sesión), se muestra el estado de confirmación de reserva SIN asumir
  // nada sobre el estado del pago -- la verdad del pago vive solo en
  // urlConfirmation/payment/getStatus, nunca en la sola llegada a esta URL.
  if (searchParams.get('flow_return') === '1') {
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center p-8">
        <div className="card w-full max-w-md text-center p-8">
          <h2 className="font-display text-2xl text-slate-900 mb-2">¡Listo!</h2>
          <p className="text-slate-500 text-sm">
            Tu sesión ya está agendada. Si el pago quedó pendiente, tu terapeuta te lo
            confirmará por email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream-100 px-3 py-6 sm:px-6 lg:py-12">
      <div
        className={
          profile
            ? 'mx-auto max-w-5xl grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-8 lg:items-start'
            : 'mx-auto max-w-2xl'
        }
      >
        {profile && (
          <aside className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
            <ProfileCard profile={profile} avatarUrl={getPublicTherapistAvatarUrl(therapistId)} />
          </aside>
        )}
        <main className="card p-4 sm:p-6 min-w-0">
          <h2 className="font-display text-2xl text-slate-900 mb-1">Agenda tu sesión</h2>
          <p className="text-slate-500 text-sm mb-6">
            Elige un horario disponible para reservar.
          </p>

          {takenMessage && <ErrorBanner message={takenMessage} className="mb-4" />}

          {isLoading && <p className="text-sm text-slate-500 mb-3">Cargando disponibilidad...</p>}
          {isError && (
            <ErrorBanner
              message="No se pudo cargar la disponibilidad. Intenta nuevamente."
              className="mb-3"
            />
          )}

          <BookingCalendar
            viewMonth={viewMonth}
            days={grid.days}
            slotsByDay={slotsByDay}
            selectedDay={selectedDay}
            todayKey={todayKey}
            busy={isLoading}
            onPrevMonth={() => changeMonth(-1)}
            onNextMonth={() => changeMonth(1)}
            onSelectDay={(day) => {
              setSelectedDay(day);
              setSelectedSlot(null);
              setTakenMessage('');
            }}
          />

          {selectedDay && (
            <section ref={slotsRef} className="mb-6">
              <SlotList
                dayKey={selectedDay}
                slots={slotsByDay[selectedDay] ?? []}
                selectedStart={selectedSlot?.start ?? null}
                onSelect={(slot) => {
                  setSelectedSlot(slot);
                  setTakenMessage('');
                }}
              />
            </section>
          )}

          {selectedSlot && (
            <section ref={formRef}>
              <PublicBookingForm
                therapistId={therapistId}
                slotStart={selectedSlot.start}
                onSuccess={setConfirmation}
                onSlotTaken={handleSlotTaken}
                origin={origin}
              />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

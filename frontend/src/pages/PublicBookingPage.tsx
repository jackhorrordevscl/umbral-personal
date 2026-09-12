import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PublicBookingForm from '../components/booking/PublicBookingForm';
import ErrorBanner from '../components/ui/ErrorBanner';
import { usePublicAvailability } from '../hooks/usePublicScheduling';
import { getBookingCheckout } from '../api/publicScheduling';
import {
  buildLocalISO,
  chileMonthGridRange,
  formatChileDate,
  formatSlotTimeRange,
  groupSlotsByChileDay,
  toChileDayKey,
} from '../utils/datetime';
import type { BookingConfirmation, PublicSlot } from '../api/publicScheduling';

// sdd/public-booking-payment-calendar PR 5 (tasks.md 5.4, design.md
// Decision 5 "Checkout is polled, not awaited"): ensureCharge() es
// fire-and-forget en el backend, así que paymentUrl casi nunca existe
// todavía cuando book() responde. Constantes nombradas a propósito (design.md
// Open Questions: "Poll budget and interval... proposed: 2s / ~15s") para que
// una PR futura pueda ajustar el presupuesto sin tocar la lógica de polling.
export const CHECKOUT_POLL_INTERVAL_MS = 2000;
export const CHECKOUT_POLL_TIMEOUT_MS = 15000;

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface ViewMonth {
  year: number;
  month: number; // 1-indexado
}

// Mismo criterio que CalendarPage.chileTodayViewMonth -- "hoy" anclado a
// America/Santiago, no al huso horario del dispositivo del visitante.
function chileTodayViewMonth(): ViewMonth {
  const [year, month] = toChileDayKey(new Date().toISOString()).split('-').map(Number);
  return { year, month };
}

function addMonths(view: ViewMonth, delta: number): ViewMonth {
  const zeroIndexed = view.month - 1 + delta;
  const year = view.year + Math.floor(zeroIndexed / 12);
  const month = ((zeroIndexed % 12) + 12) % 12 + 1;
  return { year, month };
}

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
  const [viewMonth, setViewMonth] = useState<ViewMonth>(chileTodayViewMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [takenMessage, setTakenMessage] = useState('');
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutPollExhausted, setCheckoutPollExhausted] = useState(false);

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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
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
    <div className="min-h-screen bg-slate-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto bg-cream-50 rounded-2xl p-6">
        <h2 className="font-display text-2xl text-slate-900 mb-1">Agenda tu sesión</h2>
        <p className="text-slate-500 text-sm mb-6">
          Elige un horario disponible para reservar.
        </p>

        {takenMessage && <ErrorBanner message={takenMessage} className="mb-4" />}

        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => setViewMonth((prev) => addMonths(prev, -1))}
            aria-label="Mes anterior"
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="font-medium text-slate-800 capitalize">
            {MONTH_LABELS[viewMonth.month - 1]} {viewMonth.year}
          </p>
          <button
            type="button"
            onClick={() => setViewMonth((prev) => addMonths(prev, 1))}
            aria-label="Mes siguiente"
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {isLoading && <p className="text-sm text-slate-500">Cargando disponibilidad...</p>}
        {isError && (
          <ErrorBanner message="No se pudo cargar la disponibilidad. Intenta nuevamente." />
        )}

        <div
          className="grid grid-cols-7 gap-1 mb-6"
          role="group"
          aria-label="Días con horarios disponibles"
        >
          {grid.days.map((day) => {
            const daySlots = slotsByDay[day] ?? [];
            const isCurrentMonth = Number(day.split('-')[1]) === viewMonth.month;
            const hasSlots = daySlots.length > 0;
            return (
              <button
                key={day}
                type="button"
                disabled={!hasSlots}
                onClick={() => {
                  setSelectedDay(day);
                  setSelectedSlot(null);
                }}
                aria-label={`Ver horarios del ${day}`}
                aria-pressed={selectedDay === day}
                className={[
                  'text-xs rounded-lg py-2',
                  isCurrentMonth ? 'text-slate-700' : 'text-slate-300',
                  hasSlots ? 'bg-emerald-50 hover:bg-emerald-100' : 'cursor-not-allowed',
                  selectedDay === day ? 'ring-2 ring-emerald-400' : '',
                ].join(' ')}
              >
                {Number(day.split('-')[2])}
              </button>
            );
          })}
        </div>

        {selectedDay && (
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-700 mb-2">
              Horarios para el {formatChileDate(buildLocalISO(selectedDay, '00:00'))}
            </p>
            {(slotsByDay[selectedDay] ?? []).length === 0 ? (
              <p className="text-xs text-slate-400">Sin horarios disponibles este día.</p>
            ) : (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Horarios disponibles"
              >
                {(slotsByDay[selectedDay] ?? []).map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    aria-pressed={selectedSlot?.start === slot.start}
                    className={[
                      'text-xs px-3 py-1.5 rounded-lg border',
                      selectedSlot?.start === slot.start
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {formatSlotTimeRange(slot.start, slot.end)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedSlot && (
          <PublicBookingForm
            therapistId={therapistId}
            slotStart={selectedSlot.start}
            onSuccess={setConfirmation}
            onSlotTaken={handleSlotTaken}
          />
        )}
      </div>
    </div>
  );
}

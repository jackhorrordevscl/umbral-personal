import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTH_LABELS, WEEKDAY_LABELS } from '../../utils/booking-calendar';
import type { ViewMonth } from '../../utils/booking-calendar';
import { buildLocalISO, formatChileLongDate } from '../../utils/datetime';
import type { PublicSlot } from '../../api/publicScheduling';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

const NAV_BUTTON = `inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-cream-100 hover:text-slate-800 ${FOCUS_RING}`;

// Punto inferior en la celda de hoy: refuerza aria-current con una señal que
// no depende solo del color.
const TODAY_MARK =
  'after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:rounded-full';

interface BookingCalendarProps {
  viewMonth: ViewMonth;
  days: string[]; // grid.days de chileMonthGridRange (42 celdas)
  slotsByDay: Record<string, PublicSlot[]>;
  selectedDay: string | null;
  todayKey: string; // YYYY-MM-DD en America/Santiago
  busy: boolean; // aria-busy durante la carga
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDay: (dayKey: string) => void;
}

function cellClasses(
  hasSlots: boolean,
  isSelected: boolean,
  isToday: boolean,
  isCurrentMonth: boolean,
): string {
  const base = `relative h-11 w-full rounded-lg text-sm tabular-nums transition-colors ${FOCUS_RING}`;
  let tone: string;
  // hasSlots va primero: una celda deshabilitada nunca debe verse seleccionada
  // (p. ej. si un refetch le quitó los horarios al día elegido).
  if (hasSlots && isSelected) {
    tone = 'bg-sage-600 text-white font-semibold';
  } else if (hasSlots) {
    tone = 'bg-sage-50 text-sage-700 font-medium hover:bg-sage-100';
  } else {
    tone = `${isToday ? 'text-slate-500' : 'text-slate-300'} cursor-not-allowed`;
  }
  return [
    base,
    tone,
    !isCurrentMonth && !hasSlots ? 'opacity-60' : '',
    isToday
      ? `${TODAY_MARK} ${hasSlots && isSelected ? 'after:bg-white' : 'after:bg-sage-500'}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export default function BookingCalendar({
  viewMonth,
  days,
  slotsByDay,
  selectedDay,
  todayKey,
  busy,
  onPrevMonth,
  onNextMonth,
  onSelectDay,
}: BookingCalendarProps) {
  // Los 42 nombres accesibles solo dependen de `days`: se calculan una vez por
  // grilla y no en cada render del padre.
  const dayLabels = useMemo(
    () =>
      Object.fromEntries(
        days.map((day) => [
          day,
          `Ver horarios del ${formatChileLongDate(new Date(buildLocalISO(day, '12:00')))}`,
        ]),
      ),
    [days],
  );

  const daysWithSlots = days.filter((day) => (slotsByDay[day] ?? []).length > 0).length;
  const monthLabel = `${MONTH_LABELS[viewMonth.month - 1]} ${viewMonth.year}`;
  // Una sola región live: queda vacía mientras carga y anuncia el resultado al
  // terminar, así los clics rápidos en el mes no encolan varios anuncios.
  const availabilityStatus = busy
    ? ''
    : daysWithSlots === 0
      ? `${monthLabel}: sin horarios este mes`
      : `${monthLabel}: ${daysWithSlots} ${daysWithSlots === 1 ? 'día con horarios' : 'días con horarios'}`;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-label="Mes anterior"
          className={NAV_BUTTON}
        >
          <ChevronLeft size={18} />
        </button>
        <p className="font-display text-xl text-slate-900">{monthLabel}</p>
        <button
          type="button"
          onClick={onNextMonth}
          aria-label="Mes siguiente"
          className={NAV_BUTTON}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <p role="status" className="sr-only">
        {availabilityStatus}
      </p>

      <div
        className="grid grid-cols-7 gap-1 mb-1 text-center text-xs font-medium uppercase tracking-wide text-slate-400"
        aria-hidden="true"
      >
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-1"
        role="group"
        aria-label="Días con horarios disponibles"
        aria-busy={busy}
      >
        {days.map((day) => {
          const hasSlots = (slotsByDay[day] ?? []).length > 0;
          const isCurrentMonth = Number(day.split('-')[1]) === viewMonth.month;
          const isSelected = selectedDay === day;
          const isToday = day === todayKey;
          return (
            <button
              key={day}
              type="button"
              disabled={!hasSlots}
              onClick={() => onSelectDay(day)}
              aria-label={dayLabels[day]}
              aria-pressed={isSelected && hasSlots}
              aria-current={isToday ? 'date' : undefined}
              className={cellClasses(
                hasSlots,
                isSelected,
                isToday,
                isCurrentMonth,
              )}
            >
              {Number(day.split('-')[2])}
              {hasSlots && (
                <span
                  aria-hidden="true"
                  className={`absolute right-1 top-1 text-[10px] leading-none font-normal ${isSelected ? 'text-white' : 'text-sage-700'}`}
                >
                  {slotsByDay[day].length > 9 ? '9+' : slotsByDay[day].length}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

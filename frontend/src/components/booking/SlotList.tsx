import {
  buildLocalISO,
  formatChileLongDate,
  formatSlotTimeRange,
} from '../../utils/datetime';
import type { PublicSlot } from '../../api/publicScheduling';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

interface SlotListProps {
  dayKey: string;
  slots: PublicSlot[];
  selectedStart: string | null;
  onSelect: (slot: PublicSlot) => void;
}

// Presentacional puro: los textos y roles (grupo "Horarios disponibles",
// aria-pressed, nombre accesible = rango horario) son contrato congelado.
export default function SlotList({
  dayKey,
  slots,
  selectedStart,
  onSelect,
}: SlotListProps) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700 mb-2">
        Horarios para el{' '}
        {formatChileLongDate(new Date(buildLocalISO(dayKey, '12:00')))}
      </p>
      {slots.length === 0 ? (
        <p className="text-xs text-slate-400">
          Sin horarios disponibles este día.
        </p>
      ) : (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-2"
          role="group"
          aria-label="Horarios disponibles"
        >
          {slots.map((slot) => (
            <button
              key={slot.start}
              type="button"
              onClick={() => onSelect(slot)}
              aria-pressed={selectedStart === slot.start}
              className={[
                'min-h-11 px-3 rounded-lg border text-sm tabular-nums transition-colors',
                FOCUS_RING,
                selectedStart === slot.start
                  ? 'bg-sage-600 text-white border-sage-600'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-sage-400 hover:bg-sage-50',
              ].join(' ')}
            >
              {formatSlotTimeRange(slot.start, slot.end)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

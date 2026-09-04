import { formatChileTime } from '../../utils/datetime';
import type { CalendarSession } from '../../api/consultations';

interface DayCellProps {
  /** Día calendario "YYYY-MM-DD" (celda del grid, puede ser spillover). */
  day: string;
  /** Si este día pertenece al mes actualmente visto (vs. spillover). */
  isCurrentMonth: boolean;
  sessions: CalendarSession[];
  onClick: () => void;
}

// Máximo de chips visibles antes de colapsar en "+N más" -- design.md
// "DayCell.tsx: día número, chips de sesión, overflow +N más" (tasks.md 5.5).
const MAX_VISIBLE_CHIPS = 3;

export default function DayCell({ day, isCurrentMonth, sessions, onClick }: DayCellProps) {
  const dayNumber = Number(day.split('-')[2]);
  const visible = sessions.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = sessions.length - visible.length;

  return (
    <button
      type="button"
      data-testid={`day-cell-${day}`}
      onClick={onClick}
      className={`min-h-24 p-1.5 border border-slate-100 text-left flex flex-col gap-1 hover:bg-cream-50 transition-colors ${
        isCurrentMonth ? 'bg-white' : 'bg-slate-50 text-slate-400'
      }`}
    >
      <span className={`text-xs font-medium ${isCurrentMonth ? 'text-slate-700' : 'text-slate-500'}`}>
        {dayNumber}
      </span>
      <div className="flex flex-col gap-0.5">
        {visible.map((s) => (
          <span
            key={s.id}
            className="text-[10px] leading-tight px-1 py-0.5 rounded bg-sage-50 text-sage-700 truncate"
          >
            {formatChileTime(s.sessionDate)} {s.patientName}
          </span>
        ))}
        {overflowCount > 0 && (
          <span className="text-[10px] text-slate-500">+{overflowCount} más</span>
        )}
      </div>
    </button>
  );
}

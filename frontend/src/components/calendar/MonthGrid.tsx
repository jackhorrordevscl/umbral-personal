import DayCell from './DayCell';
import type { CalendarSession } from '../../api/consultations';

interface MonthGridProps {
  /** Los 42 días "YYYY-MM-DD" del grid 6x7 (incluye spillover), en orden. */
  days: string[];
  /** Mes actualmente visto, 1-indexado -- para distinguir spillover. */
  currentMonth: number;
  sessionsByDay: Record<string, CalendarSession[]>;
  onDayClick: (day: string) => void;
}

// Semana empieza lunes (mismo criterio que chileMonthGridRange en
// utils/datetime.ts) -- design.md "MonthGrid.tsx: grid Tailwind 7 columnas,
// header de días de semana" (tasks.md 5.4).
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function monthOf(day: string): number {
  return Number(day.split('-')[1]);
}

export default function MonthGrid({ days, currentMonth, sessionsByDay, onDayClick }: MonthGridProps) {
  return (
    <div className="grid grid-cols-7 gap-px bg-slate-100 border border-slate-100 rounded-lg overflow-hidden">
      {WEEKDAY_LABELS.map((label) => (
        <div
          key={label}
          className="bg-slate-50 text-center text-[11px] font-medium text-slate-500 py-1.5"
        >
          {label}
        </div>
      ))}
      {days.map((day) => (
        <DayCell
          key={day}
          day={day}
          isCurrentMonth={monthOf(day) === currentMonth}
          sessions={sessionsByDay[day] ?? []}
          onClick={() => onDayClick(day)}
        />
      ))}
    </div>
  );
}

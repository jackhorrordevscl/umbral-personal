import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MonthGrid from '../components/calendar/MonthGrid';
import DayDetailModal from '../components/calendar/DayDetailModal';
import CalendarSyncBadge from '../components/calendar/CalendarSyncBadge';
import { useCalendarSessions } from '../hooks/useCalendarSessions';
import { chileMonthGridRange, toChileDayKey } from '../utils/datetime';
import type { CalendarSession } from '../api/consultations';

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface ViewMonth {
  year: number;
  month: number; // 1-indexado
}

// "Hoy" anclado a America/Santiago (reutiliza toChileDayKey) -- no al huso
// horario del dispositivo del profesional, consistente con el resto del
// módulo de calendario (design.md "All date bucketing is pinned to
// America/Santiago").
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

// session-calendar: agrupa las sesiones del rango por día calendario de
// Chile -- session-calendar Req: Session Date Anchoring (bucketea por
// sessionDate vía toChileDayKey, no por ningún otro campo) (tasks.md 5.8).
function groupByChileDay(sessions: CalendarSession[]): Record<string, CalendarSession[]> {
  const map: Record<string, CalendarSession[]> = {};
  for (const session of sessions) {
    const key = toChileDayKey(session.sessionDate);
    (map[key] ??= []).push(session);
  }
  return map;
}

export default function CalendarPage() {
  const [viewMonth, setViewMonth] = useState<ViewMonth>(chileTodayViewMonth);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const grid = useMemo(
    () => chileMonthGridRange(viewMonth.year, viewMonth.month),
    [viewMonth],
  );

  const { data: sessions = [] } = useCalendarSessions(grid.from, grid.to);
  const sessionsByDay = useMemo(() => groupByChileDay(sessions), [sessions]);

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8 flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl md:text-3xl text-slate-900">Calendario</h2>
          <p className="text-slate-500 text-sm mt-1">Agenda mensual de tus sesiones</p>
        </div>
        <CalendarSyncBadge />
      </div>

      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => setViewMonth((prev) => addMonths(prev, -1))}
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
          aria-label="Mes anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="font-medium text-slate-800 capitalize">
          {MONTH_LABELS[viewMonth.month - 1]} {viewMonth.year}
        </p>
        <button
          type="button"
          onClick={() => setViewMonth((prev) => addMonths(prev, 1))}
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
          aria-label="Mes siguiente"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <MonthGrid
        days={grid.days}
        currentMonth={viewMonth.month}
        sessionsByDay={sessionsByDay}
        onDayClick={setSelectedDay}
      />

      {selectedDay && (
        <DayDetailModal
          day={selectedDay}
          sessions={sessionsByDay[selectedDay] ?? []}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

import { toChileDayKey } from './datetime';

export interface ViewMonth {
  year: number;
  month: number; // 1-indexado
}

export const MONTH_LABELS: readonly string[] = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// La grilla de chileMonthGridRange empieza en lunes.
export const WEEKDAY_LABELS: readonly string[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// "Hoy" anclado a America/Santiago, no al huso horario del dispositivo.
// Compartido por CalendarPage y la agenda pública.
export function chileTodayViewMonth(): ViewMonth {
  const [year, month] = toChileDayKey(new Date().toISOString()).split('-').map(Number);
  return { year, month };
}

export function addMonths(view: ViewMonth, delta: number): ViewMonth {
  const zeroIndexed = view.month - 1 + delta;
  const year = view.year + Math.floor(zeroIndexed / 12);
  const month = ((zeroIndexed % 12) + 12) % 12 + 1;
  return { year, month };
}

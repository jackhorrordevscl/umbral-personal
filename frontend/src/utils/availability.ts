// sdd/patient-self-scheduling PR 4 (tasks.md 4.1/4.2): helpers puros para el
// editor de horarios y bloqueos de Profile. `startMinute`/`endMinute` es el
// mismo shape que TherapistAvailability del backend (design.md Decision 5
// "Wall-clock storage") -- estas funciones convierten entre ese shape y los
// inputs `<input type="time">` ("HH:MM") que usa el formulario.

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeString(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Avanza (o retrocede, con `days` negativo) un "YYYY-MM-DD" por días
// calendario planos -- mismo criterio que addDaysToDayKey del backend
// (chile-time.util.ts): delega el rollover de mes/año a Date.UTC en vez de
// calcularlo a mano. Usado por BlockoutEditor para convertir un bloqueo de
// día completo / rango de fechas (inclusivo) al intervalo semiabierto
// [startsAt, endsAt) que espera el backend (design.md Decision 4).
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

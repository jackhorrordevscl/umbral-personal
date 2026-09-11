// sdd/patient-self-scheduling PR 2 (design.md "Slot grid", tasks.md 2.1):
// backend mirror of frontend/src/utils/datetime.ts's Chile wall-clock helpers
// (buildLocalISO / toChileDayKey). computeSlots needs the same wall-clock <->
// instant conversion, but keyed by (dayKey, minuteOfDay) instead of
// (date, time) strings, and must be able to REPORT a DST-nonexistent time
// instead of silently producing a wrong instant (design.md "DST-nonexistent
// times are skipped, repeated times take the first occurrence").
export const CHILE_TIMEZONE = 'America/Santiago';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface ChileWallClockParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const CHILE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: CHILE_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function chileWallClockParts(instant: Date): ChileWallClockParts {
  const raw: Record<string, string> = {};
  for (const part of CHILE_PARTS_FORMATTER.formatToParts(instant)) {
    if (part.type !== 'literal') raw[part.type] = part.value;
  }
  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    hour: Number(raw.hour),
    minute: Number(raw.minute),
  };
}

// Día calendario ("YYYY-MM-DD") de Chile en el que cae un instante real --
// mismo criterio que frontend toChileDayKey, pero sin pasar por
// toLocaleDateString para poder reusar el mismo formatter de arriba.
export function chileDayKeyFromInstant(instant: Date): string {
  const parts = chileWallClockParts(instant);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

// Extrae la fecha calendario de una columna Postgres @db.Date (PublicHoliday)
// tal cual, SIN pasar por Santiago: Prisma entrega esas columnas como
// medianoche UTC de esa fecha exacta, así que convertir por huso horario acá
// restaría horas y devolvería el día anterior. Deliberadamente distinto de
// chileDayKeyFromInstant, que sí convierte (para instantes reales, no
// columnas @db.Date).
export function dateOnlyDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

// El día de la semana ISO (1=lunes..7=domingo) de una fecha calendario no
// depende del huso horario -- parsear el dayKey a medianoche UTC alcanza.
export function isoWeekdayFromDayKey(dayKey: string): number {
  const dow = new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

// Avanza (o retrocede, con `days` negativo) un dayKey por días calendario
// planos -- delega el rollover de mes/año a Date.UTC, mismo criterio que
// dateKeyFromUTCComponents del frontend.
export function addDaysToDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Convierte una hora de reloj de pared de Chile -- (dayKey, minuteOfDay) --
// al instante UTC real que nombra, usando el mismo truco de punto fijo que
// buildLocalISO del frontend: trata los dígitos de reloj de pared como si ya
// fueran UTC, lee lo que Santiago muestra en ese instante UTC para derivar el
// offset, y lo aplica. Verifica el resultado reformateando el instante
// producido a través de Santiago: si no vuelve exactamente al (dayKey,
// minuteOfDay) pedido, esa hora de reloj de pared nunca existió (gap de
// inicio de horario de verano) y devuelve null. Cuando la hora es ambigua
// (hora repetida al terminar el horario de verano), este mismo cálculo de
// punto fijo siempre resuelve al primero de los dos instantes reales -- la
// primera ocurrencia (verificado empíricamente contra la base tz real de
// Node para las transiciones de Chile en 2026, ver chile-time.util.spec.ts).
// "Horas detrás de UTC" (positivo en Chile) vigentes en Santiago en el
// instante dado -- mismo cálculo que buildLocalISO del frontend, extraído acá
// para poder aplicarlo dos veces (ver chileWallTimeToInstant).
function chileOffsetMinutesAt(instant: Date): number {
  const parts = chileWallClockParts(instant);
  const zonedAsUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return (instant.getTime() - zonedAsUTC) / 60000;
}

export function chileWallTimeToInstant(
  dayKey: string,
  minuteOfDay: number,
): Date | null {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const time = `${pad2(hour)}:${pad2(minute)}`;
  const asUTC = new Date(`${dayKey}T${time}:00Z`);

  // Punto fijo de dos pasos: el primer guess usa el offset vigente al tratar
  // los dígitos de reloj de pared como si fueran UTC; el segundo refina
  // usando el offset vigente en el instante candidato ya resuelto por el
  // primer guess. Un solo paso alcanza para la inmensa mayoría de horas, pero
  // falla justo después de un gap de horario de verano (la hora inmediata al
  // gap cae del otro lado de la transición real que el guess ingenuo asume) --
  // ver chile-time.util.spec.ts, caso "la hora inmediatamente posterior al
  // gap sí existe".
  const firstGuessOffset = chileOffsetMinutesAt(asUTC);
  const candidate = new Date(asUTC.getTime() + firstGuessOffset * 60000);
  const refinedOffset = chileOffsetMinutesAt(candidate);
  const instant = new Date(asUTC.getTime() + refinedOffset * 60000);

  const verify = chileWallClockParts(instant);
  const verifyDayKey = `${verify.year}-${pad2(verify.month)}-${pad2(verify.day)}`;
  const verifyMinute = verify.hour * 60 + verify.minute;
  if (verifyDayKey !== dayKey || verifyMinute !== minuteOfDay) {
    return null;
  }
  return instant;
}

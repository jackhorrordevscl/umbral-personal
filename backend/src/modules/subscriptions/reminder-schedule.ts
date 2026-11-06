// Issue #611 (PR 4): avisos de vencimiento a los 5, 1 y 0 días.
export const REMINDER_OFFSETS_DAYS = [5, 1, 0] as const;
export type ReminderOffsetDays = (typeof REMINDER_OFFSETS_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DueReminders {
  // El aviso más urgente ya vencido; es el único que se envía.
  send: ReminderOffsetDays | null;
  // Avisos anteriores que ya perdieron sentido: se reclaman sin enviar, de
  // modo que un cron caído avise lo pendiente una sola vez.
  skip: ReminderOffsetDays[];
}

const SCHEDULE_TIME_ZONE = 'America/Santiago';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Número de día calendario en Santiago (independiente de la hora y del
// horario de verano), para comparar días y no milisegundos.
export function santiagoDayNumber(date: Date): number {
  const parts = dayFormatter.formatToParts(date);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return Math.round(
    Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS,
  );
}

// Issue #633: el cron corre una vez al día, así que "vence mañana" y "vence
// en 5 días" se deciden por día calendario de Santiago (no por milisegundos
// exactos, que corrían el aviso hasta un día según la hora del vencimiento).
// El aviso de 0 días sigue siendo exacto: dice "venció", así que solo sale
// pasado el vencimiento real.
export function resolveDueReminders(
  now: Date,
  currentPeriodEnd: Date,
): DueReminders {
  const daysLeft = santiagoDayNumber(currentPeriodEnd) - santiagoDayNumber(now);
  const due = REMINDER_OFFSETS_DAYS.filter((offset) =>
    offset === 0
      ? now.getTime() >= currentPeriodEnd.getTime()
      : daysLeft <= offset,
  );
  if (due.length === 0) return { send: null, skip: [] };
  const send = Math.min(...due) as ReminderOffsetDays;
  return { send, skip: due.filter((offset) => offset !== send) };
}

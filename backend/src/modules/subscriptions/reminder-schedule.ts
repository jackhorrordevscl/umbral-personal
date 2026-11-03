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

export function resolveDueReminders(
  now: Date,
  currentPeriodEnd: Date,
): DueReminders {
  const due = REMINDER_OFFSETS_DAYS.filter(
    (offset) => now.getTime() >= currentPeriodEnd.getTime() - offset * DAY_MS,
  );
  if (due.length === 0) return { send: null, skip: [] };
  const send = Math.min(...due) as ReminderOffsetDays;
  return { send, skip: due.filter((offset) => offset !== send) };
}

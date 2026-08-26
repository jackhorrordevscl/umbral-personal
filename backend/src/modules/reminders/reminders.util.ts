import { ReminderOffset } from '@prisma/client';
import { REMINDER_OFFSETS } from './reminders.constants';

export interface DueOffsetsResult {
  // Offset a despachar en este tick (o null si ninguno está due). Nunca más
  // de uno -- ver "nearest-offset-only" abajo.
  dispatch: ReminderOffset | null;
  // Offsets que también están matemáticamente due en este mismo instante
  // pero NO se despachan porque `dispatch` es más cercano a sessionDate.
  // RemindersService los escribe con status SKIPPED (design.md "When
  // multiple offsets are simultaneously due, only the nearest fires").
  skipped: ReminderOffset[];
}

// Due-ness como predicado de instante puro, no como banda de tiempo -- ver
// design.md "Due-ness as an instant predicate, not a time band". Un offset
// está due cuando `sessionDate - offset.ms <= now`; esto hace que:
//  - un tick atrasado igual dispare (no depende de una ventana ±5min),
//  - una sesión creada dentro de la ventana dispare inmediatamente en el
//    siguiente tick (Business Rule 1), y
//  - si más de un offset está due a la vez, solo se despacha el más cercano
//    a sessionDate (menor `ms`); el resto queda skipped, nunca pendiente.
export function resolveDueOffsets(
  now: Date,
  sessionDate: Date,
): DueOffsetsResult {
  const nowMs = now.getTime();
  const sessionMs = sessionDate.getTime();

  if (sessionMs <= nowMs) {
    return { dispatch: null, skipped: [] };
  }

  const due = REMINDER_OFFSETS.filter(
    (offset) => sessionMs - offset.ms <= nowMs,
  );

  if (due.length === 0) {
    return { dispatch: null, skipped: [] };
  }

  const nearest = due.reduce((closest, candidate) =>
    candidate.ms < closest.ms ? candidate : closest,
  );

  const skipped = due
    .filter((offset) => offset.kind !== nearest.kind)
    .map((offset) => offset.kind);

  return { dispatch: nearest.kind, skipped };
}

import { Prisma, ReminderOffset } from '@prisma/client';
import { REMINDER_CHANNELS, REMINDER_OFFSETS } from './reminders.constants';

// issue #286 (parte 2): filtro Prisma que deja pasar solo las consultas que
// todavía necesitan algo en `now`, para que el lote del scan no se llene de
// consultas ya reclamadas. Replica resolveDueOffsets de forma declarativa y
// genérica sobre REMINDER_OFFSETS: la ventana (now, now + max offset] se parte
// en tramos por offset (de menor a mayor `ms`); en el tramo i están due los
// offsets de `ms` >= ms[i] (el más cercano se despacha y el resto queda
// SKIPPED). La consulta es accionable si, para ALGÚN offset due, falta una
// fila de ReminderDispatch en algún canal (cualquier status cuenta como
// reclamada: FAILED/PENDING los recoge retryStaleDispatches). Una consulta
// reprogramada/corregida es una fila nueva sin dispatches, así que siempre
// es accionable.
export function buildActionableConsultationWhere(
  now: Date,
): Prisma.ConsultationWhereInput {
  const nowMs = now.getTime();
  const offsets = [...REMINDER_OFFSETS].sort((a, b) => a.ms - b.ms);

  const bands = offsets.map((offset, index) => {
    const lowerMs = index === 0 ? 0 : offsets[index - 1].ms;
    const dueKinds = offsets.slice(index).map((o) => o.kind);

    return {
      sessionDate: {
        gt: new Date(nowMs + lowerMs),
        lte: new Date(nowMs + offset.ms),
      },
      OR: dueKinds.map((kind) => ({
        NOT: {
          AND: REMINDER_CHANNELS.map((channel) => ({
            reminderDispatches: { some: { offsetKind: kind, channel } },
          })),
        },
      })),
    };
  });

  return { OR: bands };
}

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

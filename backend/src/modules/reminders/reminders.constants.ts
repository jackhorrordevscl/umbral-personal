import { ReminderOffset } from '@prisma/client';

// sdd/session-reminders PR 2: due-ness es aritmética de instantes en UTC
// (ver design.md "UTC instant arithmetic; explicit render zone") -- el orden
// de este arreglo no importa para la lógica de due-ness, pero se declara de
// mayor a menor `ms` para que sea legible en el mismo orden que ocurren en
// la vida real de una sesión (primero se vence H24, después H2).
export const REMINDER_OFFSETS: ReadonlyArray<{
  readonly kind: ReminderOffset;
  readonly ms: number;
  readonly label: string;
}> = [
  { kind: 'H24', ms: 24 * 60 * 60 * 1000, label: '24 horas' },
  { kind: 'H2', ms: 2 * 60 * 60 * 1000, label: '2 horas' },
];

// Cota superior de la ventana de scan: el offset más grande definido arriba.
// Si algún día se agrega un offset mayor a H24, este valor debe crecer con
// él (no está hardcodeado a 24h a propósito).
export const MAX_LOOKAHEAD_MS = Math.max(...REMINDER_OFFSETS.map((o) => o.ms));

// Tope de filas por tick de scan -- protege contra un scan sin límite si
// alguna vez hay miles de sesiones en la ventana de 24h.
export const SCAN_BATCH_LIMIT = 500;

// Zona horaria usada solo para renderizar fechas en texto humano (el email
// de recordatorio). La aritmética de due-ness nunca usa esto -- ver
// design.md "UTC instant arithmetic; explicit render zone".
export const RENDER_TIME_ZONE = 'America/Santiago';

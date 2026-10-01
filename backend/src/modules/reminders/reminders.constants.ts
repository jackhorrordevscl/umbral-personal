import { ReminderChannel, ReminderOffset } from '@prisma/client';

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

// Tamaño de página del scan (issue #286 parte 2: antes era un tope por tick).
// Tipado como number (no literal 500) para poder sustituirlo en los tests.
export const SCAN_BATCH_LIMIT: number = 500;

// issue #286 (parte 2): el scan pagina con cursor (sessionDate, id) hasta
// agotar la ventana, así que ninguna sesión queda sin alcanzar por estar más
// allá de SCAN_BATCH_LIMIT. Este tope de páginas por tick es solo una red de
// seguridad para que un dataset patológico no deje el cron sin límite.
export const SCAN_MAX_PAGES = 20;

// Canales por los que se despacha cada offset. Un offset solo está
// "reclamado" para una consulta cuando existe una fila por cada canal.
export const REMINDER_CHANNELS: readonly ReminderChannel[] = [
  ReminderChannel.IN_APP,
  ReminderChannel.EMAIL,
];

// issue #286: tope de intentos de envío por (offset, canal), contando el
// primero. Agotado el tope, el dispatch queda FAILED de forma definitiva.
export const REMINDER_MAX_ATTEMPTS = 3;

// issue #286: un dispatch PENDING cuyo último claim es más viejo que esto se
// considera abandonado (el proceso murió entre el claim y el envío) y pasa a
// ser reintentable. Debe ser bastante mayor que la duración de un envío.
export const REMINDER_PENDING_STALE_MS = 10 * 60 * 1000;

// issue #286: espera mínima entre el último claim de un dispatch FAILED y su
// reintento. Sin esto los intentos se agotarían todos en el mismo tick, sin
// darle tiempo a que se recupere el proveedor.
export const REMINDER_RETRY_BACKOFF_MS = 5 * 60 * 1000;

// issue #286: tope de filas reintentadas por tick.
export const RETRY_BATCH_LIMIT = 100;

// Zona horaria usada solo para renderizar fechas en texto humano (el email
// de recordatorio). La aritmética de due-ness nunca usa esto -- ver
// design.md "UTC instant arithmetic; explicit render zone".
export const RENDER_TIME_ZONE = 'America/Santiago';

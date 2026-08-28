// Construye un ISO string con offset de Chile (-03:00 o -04:00 según horario de verano).
// Calcula el offset real de America/Santiago para esa fecha/hora en vez de usar
// dt.getTimezoneOffset() (zona horaria del dispositivo) -- si el profesional usa
// el sistema desde otro huso horario, las fechas de sesión clínica quedaban
// desfasadas (issue #13).
export function buildLocalISO(date: string, time: string): string {
  if (!date) return '';
  const asUTC = new Date(`${date}T${time}:00Z`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(asUTC)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const zonedAsUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMin = (asUTC.getTime() - zonedAsUTC) / 60000; // minutos detrás de UTC (positivo en Chile)
  const sign = offsetMin <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

// Formatea fecha para mostrar en Chile
export function formatChileDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Santiago',
  });
}

export function formatChileDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-CL', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Santiago',
  });
}

// PR4 (session-calendar-view): día calendario ("YYYY-MM-DD") en el que cae
// un instante ISO, visto en America/Santiago -- no el día UTC naive. Usado
// para bucketear sesiones (session-calendar Req: Session Date Anchoring).
// 'en-CA' formatea como YYYY-MM-DD directamente, sin parsear partes a mano
// (mismo truco ya usado en ConsultationsPage.handleEditOpen).
export function toChileDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: 'America/Santiago',
  });
}

// Solo hora:minuto en Chile (mismo criterio que toLocalTime en
// ConsultationsPage.handleEditOpen) -- usado por los chips de sesión del
// grid mensual y el detalle de día (PR4).
export function formatChileTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago',
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Normaliza (y, m0, d) vía Date.UTC -- delega el rollover de mes/año a la
// aritmética de Date en vez de calcularlo a mano (días por mes, bisiestos).
function dateKeyFromUTCComponents(year: number, month0: number, day: number): string {
  const dt = new Date(Date.UTC(year, month0, day));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

const GRID_WEEKS = 6;
const GRID_CELLS = GRID_WEEKS * 7;

export interface ChileMonthGridRange {
  /** Instante ISO con offset de Chile, inicio inclusive del rango. */
  from: string;
  /** Instante ISO con offset de Chile, fin exclusivo del rango (half-open). */
  to: string;
  /** Los 42 días calendario ("YYYY-MM-DD") del grid 6x7, en orden, incluyendo
   *  celdas de spillover del mes anterior/siguiente. */
  days: string[];
}

// design.md "Range query params are ISO instants with explicit offset,
// half-open": el rango cubre el grid 6x7 completo (semana empieza lunes),
// así las celdas de spillover del mes adyacente no quedan falsamente
// vacías. `month` es 1-indexado (1=enero ... 12=diciembre).
export function chileMonthGridRange(year: number, month: number): ChileMonthGridRange {
  const firstOfMonthUTC = new Date(Date.UTC(year, month - 1, 1));
  const dow = firstOfMonthUTC.getUTCDay(); // 0=domingo..6=sábado
  const daysSinceMonday = (dow + 6) % 7;

  const gridStartUTC = new Date(Date.UTC(year, month - 1, 1 - daysSinceMonday));
  const startYear = gridStartUTC.getUTCFullYear();
  const startMonth0 = gridStartUTC.getUTCMonth();
  const startDay = gridStartUTC.getUTCDate();

  const days: string[] = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    days.push(dateKeyFromUTCComponents(startYear, startMonth0, startDay + i));
  }
  const toDateKey = dateKeyFromUTCComponents(startYear, startMonth0, startDay + GRID_CELLS);

  return {
    from: buildLocalISO(days[0], '00:00'),
    to: buildLocalISO(toDateKey, '00:00'),
    days,
  };
}
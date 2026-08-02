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
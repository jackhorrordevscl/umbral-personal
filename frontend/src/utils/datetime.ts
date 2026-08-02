// Construye un ISO string con offset de Chile (-03:00 o -04:00 según horario de verano)
export function buildLocalISO(date: string, time: string): string {
  if (!date) return '';
  // Detectar offset real del navegador en el momento
  const dt = new Date(`${date}T${time}:00`);
  const offsetMin = dt.getTimezoneOffset(); // minutos detrás de UTC (ej: 180 para UTC-3)
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
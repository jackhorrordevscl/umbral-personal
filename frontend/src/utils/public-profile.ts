export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// Defensa en profundidad: el backend ya valida http/https, pero el valor se
// vuelve a comprobar acá para no renderizar jamás un href javascript:/data:.
// Devuelve null si no es una URL http(s) válida.
export function safeWebsite(
  raw: string | null | undefined,
): { href: string; label: string } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const label = url.host + (url.pathname === '/' ? '' : url.pathname);
    return { href: url.href, label: label || raw };
  } catch {
    return null;
  }
}

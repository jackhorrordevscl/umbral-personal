export const DEFAULT_AFTER_LOGIN = '/dashboard';

interface LocationLike {
  pathname: string;
  search?: string;
  hash?: string;
}

/** Ruta completa (path + query + hash) para guardarla como `state.from`. */
export function toFromPath(location: LocationLike): string {
  return `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`;
}

/**
 * Destino tras iniciar sesión: `state.from` solo si es una ruta interna. Se
 * rechaza todo lo que no empiece con una sola '/' ("//host" y "/\host" son
 * protocol-relative para el navegador, un open redirect) y /login, para no
 * volver a la pantalla de la que se viene.
 */
export function getPostLoginPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (
    typeof from !== 'string' ||
    !from.startsWith('/') ||
    from.startsWith('//') ||
    from.startsWith('/\\') ||
    from === '/login' ||
    from.startsWith('/login?') ||
    from.startsWith('/login#')
  ) {
    return DEFAULT_AFTER_LOGIN;
  }
  return from;
}

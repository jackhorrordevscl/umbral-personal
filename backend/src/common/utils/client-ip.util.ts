// Issue #301: cálculo único de la IP real del cliente detrás de proxies.
//
// X-Forwarded-For es una lista que cada proxy AGREGA al final: el primer valor
// lo pone el cliente (falsificable) y cada proxy confiable agrega la IP de
// quien se conectó directo a él. Con N proxies confiables delante
// (TRUSTED_PROXY_HOPS), el valor confiable es el que agregó el proxy MÁS
// EXTERNO de la infra propia: índice `hops.length - N`.
//
// Si la lista trae MENOS valores que TRUSTED_PROXY_HOPS, la petición no pasó
// por toda la cadena confiable (origen alcanzable sin Cloudflare, o cabecera
// armada a mano): ningún valor de la lista es confiable, así que se cae a
// req.ip (la IP del par TCP, que el cliente no puede falsear) en vez de usar
// hops[0], que controla el atacante.
//
// Topología actual: Render detrás de Cloudflare, TRUSTED_PROXY_HOPS=3 (ver
// render.yaml y el comentario de auth.module.ts).

export interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  clientIp?: string;
}

export function getClientIp(
  req: ClientIpRequest,
  trustedProxyHops = 1,
): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwardedFor)
    ? forwardedFor.join(',')
    : forwardedFor;
  if (typeof raw === 'string') {
    const hops = raw
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    const index = hops.length - trustedProxyHops;
    if (hops.length > 0 && index >= 0) {
      return hops[index];
    }
  }
  return req.ip as string;
}

// IP ya resuelta para esta request. ClientIpMiddleware la deja en
// req.clientIp (leyendo TRUSTED_PROXY_HOPS una sola vez); los consumidores
// (auditoría, sesiones, historial de MFA) usan esto en vez de re-leer config.
// Sin middleware (specs unitarios, contextos no HTTP) cae a req.ip.
export function getRequestClientIp(req: ClientIpRequest): string {
  return (req.clientIp ?? req.ip) as string;
}

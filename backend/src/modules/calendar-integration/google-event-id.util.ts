import { createHash } from 'crypto';

// issue #497: id de evento elegido por el cliente. Google lo usa para
// deduplicar: si el POST llega pero la respuesta se pierde, el reintento manda
// el mismo id y recibe 409 en vez de crear un segundo evento sin vínculo.
// Google exige caracteres base32hex (a-v, 0-9) y 5-1024 de largo; el hex de un
// SHA-256 truncado a 32 caracteres (128 bits) cumple y es estable por
// (conexión, grupo), igual que @@unique([connectionId, groupId]) del link.
export function deterministicEventId(
  connectionId: string,
  groupId: string,
): string {
  return createHash('sha256')
    .update(`umbral:${connectionId}:${groupId}`)
    .digest('hex')
    .slice(0, 32);
}

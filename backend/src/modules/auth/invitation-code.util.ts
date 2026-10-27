import { createHash } from 'crypto';

// Issue #487: InvitationCode.codeHash guarda el SHA-256 hex del código. El
// código es de un solo uso, aleatorio y vence en 7 días, así que un hash
// rápido sin sal alcanza para que un volcado de la base de datos no entregue
// invitaciones vigentes utilizables. La migración 20261027010000 aplica la
// misma función en SQL a los códigos existentes.
export function hashInvitationCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

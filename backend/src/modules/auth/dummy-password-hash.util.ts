import * as argon2 from 'argon2';

// Hash argon2 dummy contra el que verificar cuando el email no existe -- sin
// esto, un email inexistente responde de inmediato mientras uno real corre
// argon2.verify (costoso a propósito), generando un timing oracle que
// permite enumerar cuentas aunque el mensaje de error sea idéntico en ambos
// casos. Se genera una sola vez de forma perezosa (no hardcodeado: así el
// hash es válido para la versión de argon2 realmente instalada) y se
// reusa en cada intento de login/recover con email inexistente.
//
// Compartido entre AuthService.login() y MfaService.recoverMfa(): ambos
// flujos necesitan el mismo timing-safe dummy, así que vive en un archivo
// aparte en vez de duplicarse en los dos servicios.
let dummyPasswordHash: Promise<string> | null = null;
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = argon2.hash('umbral-timing-safe-dummy-value');
  }
  return dummyPasswordHash;
}

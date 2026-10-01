// Issue #303: forma canónica de un email (sin espacios en los extremos y en
// minúsculas). Los emails se guardan y se buscan siempre así, para que
// `Ana@x.cl` y `ana@x.cl` resuelvan a la misma cuenta.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

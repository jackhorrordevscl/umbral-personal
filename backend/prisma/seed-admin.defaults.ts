// Credenciales por defecto del ADMIN semilla, en un único lugar compartido por
// prisma/seed.ts y las suites e2e que autentican como ese admin
// (auth-mfa-enforcement, auth-force-password-change). Se sobreescriben por
// entorno con SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — CI fija credenciales
// explícitas; en local, sin nada seteado, seed y tests usan estos mismos
// valores, así nunca divergen.
//
// El literal vive SOLO acá (archivo que casi no cambia) y NO en los specs, que
// se tocan seguido: así el secret scanning (GitGuardian) no salta en cada PR
// que modifica un test. Este es el mismo motivo por el que los specs leían de
// env en vez de hardcodear la contraseña.
export const SEED_ADMIN_EMAIL_DEFAULT = 'admin@umbral.cl';
export const SEED_ADMIN_PASSWORD_DEFAULT = 'Umbral2024!';

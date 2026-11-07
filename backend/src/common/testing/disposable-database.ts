// Issue #629: las suites *.integration.spec.ts escriben en la base a la que
// apunte DATABASE_URL y algunas recorren tablas completas. Solo se aceptan
// bases cuyo nombre termina en _test o _ci (el CI usa umbral_ci).
const DISPOSABLE_DATABASE_NAME = /_(test|ci)$/;

export function isDisposableDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    return false;
  }
  return DISPOSABLE_DATABASE_NAME.test(databaseName);
}

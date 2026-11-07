import { isDisposableDatabaseUrl } from './disposable-database';

// Issue #629: setupFilesAfterEnv de Jest. Solo actúa en las suites
// *.integration.spec.ts: si DATABASE_URL no apunta a una base descartable, la
// suite falla antes de tocar la base.
const testPath = expect.getState().testPath ?? '';

if (/\.integration\.spec\.ts$/.test(testPath)) {
  beforeAll(() => {
    if (!isDisposableDatabaseUrl(process.env.DATABASE_URL)) {
      throw new Error(
        'Las pruebas de integración escriben en la base de datos y solo corren ' +
          'contra una base descartable: el nombre de la base en DATABASE_URL debe ' +
          'terminar en "_test" o "_ci" (por ejemplo umbral_test). Ver "Pruebas de ' +
          'integración" en el README.',
      );
    }
  });
}

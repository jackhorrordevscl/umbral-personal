import { isDisposableDatabaseUrl } from './disposable-database';

describe('isDisposableDatabaseUrl (issue #629)', () => {
  it.each([
    'postgresql://umbral_ci:umbral_ci@localhost:5432/umbral_ci',
    'postgresql://u:p@localhost:5432/umbral_test',
    'postgres://u:p@127.0.0.1:5432/umbral_test?schema=public',
    'postgresql://u:p@db.example.com:5432/otra_test?pgbouncer=true',
  ])('acepta una base marcada como de prueba: %s', (url) => {
    expect(isDisposableDatabaseUrl(url)).toBe(true);
  });

  it.each([
    'postgresql://umbral_user:pass@localhost:5432/umbral_db',
    'postgresql://u:p@host:5432/postgres',
    'postgresql://u:p@host:5432/test_umbral',
    'postgresql://u:p@host:5432/umbral_testing',
    'postgresql://u:p@host:5432/umbral_ci_prod',
    'postgresql://u:p@host:5432/',
    'postgresql://u:p@host:5432/umbral_db?options=_test',
  ])('rechaza una base que no está marcada como de prueba: %s', (url) => {
    expect(isDisposableDatabaseUrl(url)).toBe(false);
  });

  it.each([undefined, '', 'esto no es una url'])(
    'rechaza una URL ausente o inválida: %s',
    (url) => {
      expect(isDisposableDatabaseUrl(url)).toBe(false);
    },
  );
});

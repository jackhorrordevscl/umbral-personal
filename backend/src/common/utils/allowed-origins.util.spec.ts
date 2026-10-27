import { getAllowedOrigins } from './allowed-origins.util';

describe('getAllowedOrigins', () => {
  it('fuera de producción incluye localhost:5173, LAN_DEV_URL y FRONTEND_URL', () => {
    expect(
      getAllowedOrigins({
        NODE_ENV: 'development',
        LAN_DEV_URL: 'http://192.168.1.10:5173',
        FRONTEND_URL: 'https://app.example.com',
      }),
    ).toEqual([
      'http://localhost:5173',
      'http://192.168.1.10:5173',
      'https://app.example.com',
    ]);
  });

  it('en producción excluye localhost:5173 y las variables sin definir', () => {
    expect(
      getAllowedOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://app.example.com',
      }),
    ).toEqual(['https://app.example.com']);
  });

  it('sin variables solo queda localhost:5173 (desarrollo)', () => {
    expect(getAllowedOrigins({})).toEqual(['http://localhost:5173']);
  });
});

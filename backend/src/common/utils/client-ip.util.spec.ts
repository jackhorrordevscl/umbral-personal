import { getClientIp, getRequestClientIp } from './client-ip.util';

describe('getClientIp', () => {
  it('usa req.ip si no hay x-forwarded-for', () => {
    expect(getClientIp({ headers: {}, ip: '10.0.0.5' }, 3)).toBe('10.0.0.5');
  });

  it('con 3 hops y una lista de 3 valores elige el índice 0 (el que agregó Cloudflare)', () => {
    expect(
      getClientIp(
        {
          headers: {
            'x-forwarded-for': '198.51.100.7, 172.68.174.254, 10.27.164.133',
          },
          ip: '127.0.0.1',
        },
        3,
      ),
    ).toBe('198.51.100.7');
  });

  it('con 3 hops y una lista más larga ignora los valores que el cliente prependea', () => {
    expect(
      getClientIp(
        {
          headers: {
            'x-forwarded-for':
              '6.6.6.6, 198.51.100.7, 172.68.174.254, 10.27.164.133',
          },
          ip: '127.0.0.1',
        },
        3,
      ),
    ).toBe('198.51.100.7');
  });

  it('con una XFF armada a mano más corta que los hops cae a req.ip, sin importar su contenido', () => {
    const ips = ['1.1.1.1', '2.2.2.2'].map((forged) =>
      getClientIp(
        { headers: { 'x-forwarded-for': forged }, ip: '203.0.113.9' },
        3,
      ),
    );
    expect(ips).toEqual(['203.0.113.9', '203.0.113.9']);
  });

  it('con 1 hop (default) usa el último valor', () => {
    expect(
      getClientIp({
        headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
        ip: '10.0.0.5',
      }),
    ).toBe('203.0.113.7');
  });

  it('soporta x-forwarded-for como array de headers duplicados y descarta vacíos', () => {
    expect(
      getClientIp(
        {
          headers: { 'x-forwarded-for': ['198.51.100.99, ', ' ,203.0.113.7'] },
          ip: '10.0.0.5',
        },
        2,
      ),
    ).toBe('198.51.100.99');
  });
});

describe('getRequestClientIp', () => {
  it('prefiere req.clientIp (resuelta por el middleware)', () => {
    expect(
      getRequestClientIp({ headers: {}, ip: '10.0.0.1', clientIp: '9.9.9.9' }),
    ).toBe('9.9.9.9');
  });

  it('cae a req.ip cuando no hay clientIp', () => {
    expect(getRequestClientIp({ headers: {}, ip: '10.0.0.1' })).toBe(
      '10.0.0.1',
    );
  });
});

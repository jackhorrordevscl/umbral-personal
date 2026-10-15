import {
  SESSION_COOKIE_NAME,
  applySessionCookie,
  clearSessionCookie,
  extractSessionCookie,
  setSessionCookie,
} from './session-cookie';

function fakeJwt(exp: number): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ exp })}.firma`;
}

function fakeRes() {
  return {
    cookie: jest.fn<void, [string, string, Record<string, unknown>]>(),
    clearCookie: jest.fn(),
  };
}

describe('session-cookie (issue #387)', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('setSessionCookie', () => {
    it('emite una cookie HttpOnly, SameSite=Strict, host-only (sin Domain)', () => {
      const res = fakeRes();
      const token = fakeJwt(Math.floor(Date.now() / 1000) + 3600);

      setSessionCookie(res as never, token);

      expect(res.cookie).toHaveBeenCalledTimes(1);
      const [name, value, options] = res.cookie.mock.calls[0];
      expect(name).toBe(SESSION_COOKIE_NAME);
      expect(value).toBe(token);
      expect(options).toMatchObject({
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
      expect(options).not.toHaveProperty('domain');
      expect(options.maxAge as number).toBeGreaterThan(3_590_000);
      expect(options.maxAge as number).toBeLessThanOrEqual(3_600_000);
    });

    it('marca Secure solo en producción', () => {
      const token = fakeJwt(Math.floor(Date.now() / 1000) + 60);

      process.env.NODE_ENV = 'production';
      const prod = fakeRes();
      setSessionCookie(prod as never, token);
      expect(prod.cookie.mock.calls[0][2]).toMatchObject({ secure: true });

      process.env.NODE_ENV = 'development';
      const dev = fakeRes();
      setSessionCookie(dev as never, token);
      expect(dev.cookie.mock.calls[0][2]).toMatchObject({ secure: false });
    });

    it('usa 8 h de vida si el token no trae exp legible', () => {
      const res = fakeRes();

      setSessionCookie(res as never, 'no-es-un-jwt');

      expect(res.cookie.mock.calls[0][2]).toMatchObject({
        maxAge: 8 * 60 * 60 * 1000,
      });
    });
  });

  describe('clearSessionCookie', () => {
    it('limpia la cookie con los mismos atributos con que se emitió', () => {
      const res = fakeRes();

      clearSessionCookie(res as never);

      expect(res.clearCookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
        }),
      );
    });
  });

  describe('extractSessionCookie', () => {
    const reqWith = (cookie?: string) =>
      ({ headers: cookie === undefined ? {} : { cookie } }) as never;

    it('lee la cookie entre otras', () => {
      expect(
        extractSessionCookie(
          reqWith(`a=1; ${SESSION_COOKIE_NAME}=abc.def.ghi; b=2`),
        ),
      ).toBe('abc.def.ghi');
    });

    it('devuelve null sin header, sin la cookie o con valor vacío', () => {
      expect(extractSessionCookie(reqWith())).toBeNull();
      expect(extractSessionCookie(reqWith('a=1; b=2'))).toBeNull();
      expect(
        extractSessionCookie(reqWith(`${SESSION_COOKIE_NAME}=`)),
      ).toBeNull();
    });

    it('no confunde una cookie con nombre parecido', () => {
      expect(
        extractSessionCookie(reqWith(`x${SESSION_COOKIE_NAME}=zzz`)),
      ).toBeNull();
    });

    it('devuelve null si el valor está mal codificado', () => {
      expect(
        extractSessionCookie(reqWith(`${SESSION_COOKIE_NAME}=%E0%A4%A`)),
      ).toBeNull();
    });
  });

  describe('applySessionCookie', () => {
    it('emite la cookie cuando el resultado trae accessToken y devuelve el resultado intacto', () => {
      const res = fakeRes();
      const result = {
        accessToken: fakeJwt(Math.floor(Date.now() / 1000) + 60),
        user: { id: 'u1' },
      };

      expect(applySessionCookie(res as never, result)).toBe(result);
      expect(res.cookie).toHaveBeenCalledTimes(1);
    });

    it('no toca la cookie si no hay sesión (requiresMfa, requiresPasswordChange...)', () => {
      const res = fakeRes();

      applySessionCookie(res as never, { requiresMfa: true, mfaToken: 't' });

      expect(res.cookie).not.toHaveBeenCalled();
    });
  });
});

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionOriginGuard } from './session-origin.guard';

const FRONTEND = 'https://app.example.com';

function buildContext(
  method: string,
  headers: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers }),
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(env: Record<string, string> = {}): SessionOriginGuard {
  const values: Record<string, string> = {
    NODE_ENV: 'production',
    FRONTEND_URL: FRONTEND,
    ...env,
  };
  return new SessionOriginGuard({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

const withCookie = { cookie: 'umbral_session=token' };

describe('SessionOriginGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'deja pasar %s sin mirar el origen',
    (method) => {
      const ctx = buildContext(method, {
        ...withCookie,
        origin: 'https://evil.example.com',
      });
      expect(buildGuard().canActivate(ctx)).toBe(true);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rechaza %s con la cookie de sesión y un Origin ajeno',
    (method) => {
      const ctx = buildContext(method, {
        ...withCookie,
        origin: 'https://evil.example.com',
      });
      expect(() => buildGuard().canActivate(ctx)).toThrow(ForbiddenException);
      expect(() => buildGuard().canActivate(ctx)).toThrow(
        'Origen no permitido',
      );
    },
  );

  it('acepta la cookie de sesión con el Origin del frontend', () => {
    const ctx = buildContext('POST', { ...withCookie, origin: FRONTEND });
    expect(buildGuard().canActivate(ctx)).toBe(true);
  });

  it('ignora una barra final en el Origin configurado', () => {
    const ctx = buildContext('POST', { ...withCookie, origin: FRONTEND });
    expect(buildGuard({ FRONTEND_URL: `${FRONTEND}/` }).canActivate(ctx)).toBe(
      true,
    );
  });

  it('acepta LAN_DEV_URL y rechaza localhost:5173 en producción', () => {
    const lan = 'http://192.168.1.10:5173';
    const guard = buildGuard({ LAN_DEV_URL: lan });
    expect(
      guard.canActivate(buildContext('POST', { ...withCookie, origin: lan })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        buildContext('POST', {
          ...withCookie,
          origin: 'http://localhost:5173',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('acepta localhost:5173 fuera de producción', () => {
    const ctx = buildContext('POST', {
      ...withCookie,
      origin: 'http://localhost:5173',
    });
    expect(buildGuard({ NODE_ENV: 'development' }).canActivate(ctx)).toBe(true);
  });

  it('deja pasar un POST sin cookie de sesión aunque el Origin sea ajeno (no hay credencial que abusar)', () => {
    const ctx = buildContext('POST', { origin: 'https://evil.example.com' });
    expect(buildGuard().canActivate(ctx)).toBe(true);
  });

  it('deja pasar un POST con otras cookies pero sin la de sesión', () => {
    const ctx = buildContext('POST', {
      cookie: 'otra=1; theme=dark',
      origin: 'https://evil.example.com',
    });
    expect(buildGuard().canActivate(ctx)).toBe(true);
  });

  it('sin Origin ni Sec-Fetch-Site (cliente que no es navegador) deja pasar', () => {
    const ctx = buildContext('POST', withCookie);
    expect(buildGuard().canActivate(ctx)).toBe(true);
  });

  it.each(['cross-site', 'same-site'])(
    'sin Origin, Sec-Fetch-Site=%s con la cookie se rechaza',
    (site) => {
      const ctx = buildContext('POST', {
        ...withCookie,
        'sec-fetch-site': site,
      });
      expect(() => buildGuard().canActivate(ctx)).toThrow(ForbiddenException);
    },
  );

  it.each(['same-origin', 'none'])(
    'sin Origin, Sec-Fetch-Site=%s con la cookie deja pasar',
    (site) => {
      const ctx = buildContext('POST', {
        ...withCookie,
        'sec-fetch-site': site,
      });
      expect(buildGuard().canActivate(ctx)).toBe(true);
    },
  );

  it('el Origin manda sobre Sec-Fetch-Site: un Origin permitido pasa', () => {
    const ctx = buildContext('POST', {
      ...withCookie,
      origin: FRONTEND,
      'sec-fetch-site': 'same-site',
    });
    expect(buildGuard().canActivate(ctx)).toBe(true);
  });

  it('rechaza el Origin "null" (documento aislado / redirección)', () => {
    const ctx = buildContext('POST', { ...withCookie, origin: 'null' });
    expect(() => buildGuard().canActivate(ctx)).toThrow(ForbiddenException);
  });
});

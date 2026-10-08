import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash } from 'crypto';
import {
  buildPublicBookingExtraLimits,
  getPublicScheduleTracker,
  PUBLIC_BOOKING_IP_BUCKET,
  PublicScheduleThrottlerGuard,
} from './public-schedule-throttler.guard';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.2, design.md Decision 7 "Rate
// limiting"): mismo criterio de testeo que getLoginTracker
// (auth.module.ts/rate-limit-login.e2e-spec.ts) -- la función pura que decide
// el tracker se prueba directo, sin necesidad de levantar el guard completo
// (que requiere options/storageService/reflector reales de @nestjs/throttler).
describe('getPublicScheduleTracker', () => {
  it('usa ip:therapistId cuando el body no trae email (GET availability)', () => {
    const tracker = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
    });
    expect(tracker).toBe('10.0.0.5:therapist-1');
  });

  // Triangulación: terapeuta distinto -> tracker distinto, no hardcodeado.
  it('un therapistId distinto produce un tracker distinto', () => {
    const tracker = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-2' },
    });
    expect(tracker).toBe('10.0.0.5:therapist-2');
  });

  it('usa ip:therapistId:sha256(email) cuando el body trae patient.email (POST book)', () => {
    const tracker = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'Paciente@Ejemplo.cl' } },
    });

    expect(tracker).toMatch(/^10\.0\.0\.5:therapist-1:[a-f0-9]{64}$/);
    // El email en texto plano jamás debe aparecer en el tracker (spec.md
    // "Throttling does not leak email in logs" -- el tracker es lo que
    // @nestjs/throttler usa como clave, y potencialmente lo que termina en
    // logs de storage/debug).
    expect(tracker).not.toContain('Paciente@Ejemplo.cl');
    expect(tracker).not.toContain('paciente@ejemplo.cl');
  });

  it('normaliza el email (case-insensitive) antes de hashear: mismo email, distinto casing, mismo tracker', () => {
    const lower = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'paciente@ejemplo.cl' } },
    });
    const upper = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'PACIENTE@EJEMPLO.CL' } },
    });
    expect(lower).toBe(upper);
  });

  it('un email distinto produce un hash distinto (no siempre el mismo tracker)', () => {
    const first = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'uno@ejemplo.cl' } },
    });
    const second = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'dos@ejemplo.cl' } },
    });
    expect(first).not.toBe(second);
  });

  it('sin therapistId en params, cae a "unknown" en vez de romper', () => {
    const tracker = getPublicScheduleTracker({ ip: '10.0.0.5', params: {} });
    expect(tracker).toBe('10.0.0.5:unknown');
  });

  it('usa la IP real del cliente (issue #301), no la del proxy', () => {
    const req = (realIp: string) => ({
      ip: '10.0.0.5',
      headers: { 'x-forwarded-for': `${realIp}, 172.68.1.1, 10.27.1.1` },
      params: { therapistId: 't1' },
    });
    expect(getPublicScheduleTracker(req('198.51.100.1'), 3)).toBe(
      '198.51.100.1:t1',
    );
    expect(getPublicScheduleTracker(req('198.51.100.2'), 3)).toBe(
      '198.51.100.2:t1',
    );
  });

  it('con una XFF más corta que los hops cae a req.ip', () => {
    expect(
      getPublicScheduleTracker(
        {
          ip: '203.0.113.9',
          headers: { 'x-forwarded-for': '6.6.6.6' },
          params: { therapistId: 't1' },
        },
        3,
      ),
    ).toBe('203.0.113.9:t1');
  });

  // Minor booking: a minor may have no email; the key falls back to the
  // guardian email and then to the patient RUT, always hashed.
  describe('reserva de menores', () => {
    const sha256 = (value: string) =>
      createHash('sha256').update(value).digest('hex');
    const base = { ip: '10.0.0.5', params: { therapistId: 'therapist-1' } };

    it('con patient.email el tracker es idéntico al de un adulto aunque venga guardian', () => {
      const adult = getPublicScheduleTracker({
        ...base,
        body: { patient: { email: 'paciente@ejemplo.cl' } },
      });
      const withGuardian = getPublicScheduleTracker({
        ...base,
        body: {
          patient: { email: 'Paciente@Ejemplo.cl', rut: '11.111.111-1' },
          guardian: { email: 'madre@ejemplo.cl' },
        },
      });
      expect(withGuardian).toBe(adult);
      expect(adult).toBe(
        `10.0.0.5:therapist-1:${sha256('paciente@ejemplo.cl')}`,
      );
    });

    it('sin patient.email usa el hash del email del representante', () => {
      const tracker = getPublicScheduleTracker({
        ...base,
        body: {
          patient: { rut: '11.111.111-1' },
          guardian: { email: ' Madre@Ejemplo.cl ' },
        },
      });
      expect(tracker).toBe(
        `10.0.0.5:therapist-1:${sha256('madre@ejemplo.cl')}`,
      );
      expect(tracker.toLowerCase()).not.toContain('madre');
    });

    it('sin ningún email usa el hash del RUT del paciente, sin exponerlo', () => {
      const tracker = getPublicScheduleTracker({
        ...base,
        body: { patient: { rut: ' 11.111.111-K ' } },
      });
      expect(tracker).toBe(`10.0.0.5:therapist-1:${sha256('11.111.111-k')}`);
      expect(tracker).not.toContain('11.111.111');
    });
  });
});

// Issue #299: límites que no dependen del body (el bucket por email se reabre
// con cada email distinto).
describe('PublicScheduleThrottlerGuard (límites extra, issue #299)', () => {
  const OPTIONS = { throttlers: [] } as ThrottlerModuleOptions;

  function buildContext(method: string, therapistId = 'therapist-1') {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          ip: '10.0.0.5',
          params: { therapistId },
          body: { patient: { email: `${Math.random()}@ejemplo.cl` } },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  // Storage en memoria mínimo: cuenta hits por key y bloquea al superar limit.
  function buildStorage() {
    const hits = new Map<string, number>();
    const increment = jest.fn((key: string, _ttl: number, limit: number) => {
      const totalHits = (hits.get(key) ?? 0) + 1;
      hits.set(key, totalHits);
      return Promise.resolve({
        totalHits,
        timeToExpire: 1,
        isBlocked: totalHits > limit,
        timeToBlockExpire: 1,
      });
    });
    return { increment } as unknown as ThrottlerStorage & {
      increment: jest.Mock;
    };
  }

  function buildGuard(env: Record<string, string>, storage: ThrottlerStorage) {
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    return new PublicScheduleThrottlerGuard(
      OPTIONS,
      storage,
      new Reflector(),
      config,
    );
  }

  beforeEach(() => {
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bloquea con 429 al superar el límite por ip:therapistId aunque cambie el email', async () => {
    const guard = buildGuard(
      { PUBLIC_BOOKING_IP_THROTTLE_LIMIT: '2' },
      buildStorage(),
    );

    await expect(guard.canActivate(buildContext('POST'))).resolves.toBe(true);
    await expect(guard.canActivate(buildContext('POST'))).resolves.toBe(true);
    await expect(guard.canActivate(buildContext('POST'))).rejects.toThrow(
      ThrottlerException,
    );
  });

  it('el límite por ip:therapistId es independiente entre terapeutas', async () => {
    const guard = buildGuard(
      { PUBLIC_BOOKING_IP_THROTTLE_LIMIT: '1' },
      buildStorage(),
    );

    await expect(
      guard.canActivate(buildContext('POST', 'therapist-1')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(buildContext('POST', 'therapist-2')),
    ).resolves.toBe(true);
  });

  it('usa su propio bucket por ip:therapistId y no aplica ningún tope diario en storage', async () => {
    const storage = buildStorage();
    const guard = buildGuard({}, storage);

    await expect(guard.canActivate(buildContext('POST'))).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
    expect(storage.increment).toHaveBeenCalledWith(
      `${PUBLIC_BOOKING_IP_BUCKET}:10.0.0.5:therapist-1`,
      3600000,
      10,
      3600000,
      PUBLIC_BOOKING_IP_BUCKET,
    );
  });

  // Issue #301: detrás del proxy req.ip es la IP del proxy para todos.
  it('separa el bucket ip:therapistId por cliente real y no por proxy (TRUSTED_PROXY_HOPS=3)', async () => {
    const storage = buildStorage();
    const guard = buildGuard({ TRUSTED_PROXY_HOPS: '3' }, storage);
    const viaProxy = (realIp: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            ip: '10.0.0.5', // misma IP de proxy para todos
            headers: {
              'x-forwarded-for': `${realIp}, 172.68.1.1, 10.27.1.1`,
            },
            params: { therapistId: 'therapist-1' },
            body: {},
          }),
        }),
      }) as unknown as ExecutionContext;

    await guard.canActivate(viaProxy('198.51.100.1'));
    await guard.canActivate(viaProxy('198.51.100.2'));

    const keys = (storage.increment.mock.calls as Array<[string]>).map(
      (c) => c[0],
    );
    expect(keys).toEqual([
      `${PUBLIC_BOOKING_IP_BUCKET}:198.51.100.1:therapist-1`,
      `${PUBLIC_BOOKING_IP_BUCKET}:198.51.100.2:therapist-1`,
    ]);
  });

  it('una XFF armada a mano más corta que los hops cae a req.ip y no abre un bucket nuevo', async () => {
    const storage = buildStorage();
    const guard = buildGuard({ TRUSTED_PROXY_HOPS: '3' }, storage);
    const forged = (xff: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            ip: '203.0.113.9',
            headers: { 'x-forwarded-for': xff },
            params: { therapistId: 'therapist-1' },
            body: {},
          }),
        }),
      }) as unknown as ExecutionContext;

    await guard.canActivate(forged('1.1.1.1'));
    await guard.canActivate(forged('2.2.2.2'));

    const keys = (storage.increment.mock.calls as Array<[string]>).map(
      (c) => c[0],
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(`${PUBLIC_BOOKING_IP_BUCKET}:203.0.113.9:therapist-1`);
  });

  it('no cuenta las lecturas (GET) contra los límites extra', async () => {
    const storage = buildStorage();
    const guard = buildGuard(
      { PUBLIC_BOOKING_IP_THROTTLE_LIMIT: '1' },
      storage,
    );

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(buildContext('GET'))).resolves.toBe(true);
    }
    expect(storage.increment).not.toHaveBeenCalled();
  });

  it('respeta el rechazo del throttler base sin tocar los límites extra', async () => {
    jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(false);
    const storage = buildStorage();
    const guard = buildGuard({}, storage);

    await expect(guard.canActivate(buildContext('POST'))).resolves.toBe(false);
    expect(storage.increment).not.toHaveBeenCalled();
  });
});

describe('buildPublicBookingExtraLimits', () => {
  const cfg = (env: Record<string, string>) => ({
    get: (key: string) => env[key],
  });

  it('usa defaults conservadores fuera de test', () => {
    expect(buildPublicBookingExtraLimits(cfg({}))).toEqual({
      ipTherapistLimit: 10,
      ipTherapistTtlMs: 3600000,
    });
  });

  it('sube los límites por defecto en NODE_ENV=test', () => {
    const limits = buildPublicBookingExtraLimits(cfg({ NODE_ENV: 'test' }));
    expect(limits.ipTherapistLimit).toBe(1000);
  });

  it('ignora valores no numéricos o no positivos y cae al default', () => {
    const limits = buildPublicBookingExtraLimits(
      cfg({
        PUBLIC_BOOKING_IP_THROTTLE_LIMIT: 'abc',
        PUBLIC_BOOKING_IP_THROTTLE_TTL_MS: '0',
      }),
    );
    expect(limits.ipTherapistLimit).toBe(10);
    expect(limits.ipTherapistTtlMs).toBe(3600000);
  });
});

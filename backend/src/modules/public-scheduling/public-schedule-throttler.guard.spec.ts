import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  buildPublicBookingExtraLimits,
  getPublicScheduleTracker,
  PUBLIC_BOOKING_DAILY_BUCKET,
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

  it('aplica el tope diario por terapeuta usando su propio bucket', async () => {
    const storage = buildStorage();
    const guard = buildGuard({ PUBLIC_BOOKING_DAILY_LIMIT: '1' }, storage);

    await expect(guard.canActivate(buildContext('POST'))).resolves.toBe(true);
    await expect(guard.canActivate(buildContext('POST'))).rejects.toThrow(
      ThrottlerException,
    );
    expect(storage.increment).toHaveBeenCalledWith(
      `${PUBLIC_BOOKING_DAILY_BUCKET}:therapist-1`,
      86400000,
      1,
      86400000,
      PUBLIC_BOOKING_DAILY_BUCKET,
    );
    expect(storage.increment).toHaveBeenCalledWith(
      `${PUBLIC_BOOKING_IP_BUCKET}:10.0.0.5:therapist-1`,
      3600000,
      10,
      3600000,
      PUBLIC_BOOKING_IP_BUCKET,
    );
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
      dailyTherapistLimit: 100,
      dailyTherapistTtlMs: 86400000,
    });
  });

  it('sube los límites por defecto en NODE_ENV=test', () => {
    const limits = buildPublicBookingExtraLimits(cfg({ NODE_ENV: 'test' }));
    expect(limits.ipTherapistLimit).toBe(1000);
    expect(limits.dailyTherapistLimit).toBe(10000);
  });

  it('ignora valores no numéricos o no positivos y cae al default', () => {
    const limits = buildPublicBookingExtraLimits(
      cfg({
        PUBLIC_BOOKING_IP_THROTTLE_LIMIT: 'abc',
        PUBLIC_BOOKING_DAILY_LIMIT: '0',
      }),
    );
    expect(limits.ipTherapistLimit).toBe(10);
    expect(limits.dailyTherapistLimit).toBe(100);
  });
});

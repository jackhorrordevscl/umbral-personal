import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { buildProfileThrottlerOptions } from './profile.module';

/**
 * Issue #76 (sdd-verify CRITICAL finding): el throttler de 'profile-update'
 * usa getTracker: req => req.user.id para que el presupuesto de intentos sea
 * por usuario autenticado, no compartido por IP (varios profesionales detrás
 * de la misma IP/VPN no deben pisarse el rate limit entre sí). Este test
 * prueba esa propiedad por construcción, sin necesitar la DB del e2e.
 */
describe('buildProfileThrottlerOptions — getTracker', () => {
  function buildConfig(overrides: Record<string, string> = {}): ConfigService {
    const values: Record<string, string> = { NODE_ENV: 'test', ...overrides };
    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  // buildProfileThrottlerOptions siempre devuelve la rama objeto-con-getTracker
  // (nunca el array), y su getTracker siempre ignora `context` y devuelve un
  // string sync (nunca Promise) -- más angosto que ThrottlerGetTrackerFunction.
  // Angostamos ambas cosas explícitamente para que type-checkee sin mentir
  // sobre lo que el código de producción realmente hace.
  function getTracker(
    config: ConfigService,
  ): (req: Record<string, any>) => string {
    const options = buildProfileThrottlerOptions(config) as Extract<
      ThrottlerModuleOptions,
      { throttlers: unknown }
    >;
    return options.getTracker as unknown as (
      req: Record<string, any>,
    ) => string;
  }

  it('devuelve tracker keys distintas para dos usuarios distintos (no comparten balde de throttle)', () => {
    const tracker = getTracker(buildConfig());

    const reqUserA = {
      user: { id: 'user-aaa' },
      headers: {},
      ip: '10.0.0.1',
    };
    const reqUserB = {
      user: { id: 'user-bbb' },
      headers: {},
      ip: '10.0.0.1', // misma IP a propósito: el tracker debe ignorarla si hay user
    };

    const trackerA = tracker(reqUserA);
    const trackerB = tracker(reqUserB);

    expect(trackerA).toBe('user-aaa');
    expect(trackerB).toBe('user-bbb');
    expect(trackerA).not.toBe(trackerB);
  });

  it('el mismo usuario obtiene siempre la misma tracker key (consistente entre requests)', () => {
    const tracker = getTracker(buildConfig());

    const first = tracker({
      user: { id: 'user-aaa' },
      headers: {},
      ip: '10.0.0.1',
    });
    const second = tracker({
      user: { id: 'user-aaa' },
      headers: {},
      ip: '10.0.0.2',
    });

    expect(first).toBe(second);
    expect(first).toBe('user-aaa');
  });

  it('sin req.user (ruta email-change-confirm, sin JwtAuthGuard) cae al tracker IP-based', () => {
    const tracker = getTracker(buildConfig());

    const trackerIp = tracker({ headers: {}, ip: '203.0.113.7' });

    expect(trackerIp).toBe('203.0.113.7');
  });
});

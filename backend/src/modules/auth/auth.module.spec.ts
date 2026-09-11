import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { buildAuthThrottlerOptions } from './auth.module';

interface NamedThrottler {
  name: string;
  limit: number;
  ttl: number;
}

// ThrottlerModuleOptions es una unión (array "plano" | objeto con
// `throttlers`) -- buildAuthThrottlerOptions siempre devuelve la segunda
// forma, así que este helper solo estrecha el tipo para el test sin repetir
// el cast en cada `it`.
function getThrottlers(options: ThrottlerModuleOptions): NamedThrottler[] {
  return (options as { throttlers: NamedThrottler[] }).throttlers;
}

// sdd/patient-self-scheduling PR 3 (tasks.md 3.1, design.md Decision 7 "Rate
// limiting"): buildAuthThrottlerOptions es el único punto de registro del
// ThrottlerModule (@Global() en v6) -- los dos throttlers públicos nuevos
// deben salir de la MISMA fábrica que los de auth, o quedarían fuera del
// árbol de DI que auth.module.ts arma con ThrottlerModule.forRootAsync.
function buildConfig(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('buildAuthThrottlerOptions — throttlers públicos (public-scheduling)', () => {
  it('registra un throttler nombrado "public-availability" con límites por default', () => {
    const options = buildAuthThrottlerOptions(buildConfig());
    const throttlers = getThrottlers(options);

    const availability = throttlers.find(
      (t) => t.name === 'public-availability',
    );
    expect(availability).toBeDefined();
    expect(availability?.limit).toBeGreaterThan(0);
    expect(availability?.ttl).toBeGreaterThan(0);
  });

  it('registra un throttler nombrado "public-booking" con límites por default', () => {
    const options = buildAuthThrottlerOptions(buildConfig());
    const throttlers = getThrottlers(options);

    const booking = throttlers.find((t) => t.name === 'public-booking');
    expect(booking).toBeDefined();
    expect(booking?.limit).toBeGreaterThan(0);
    expect(booking?.ttl).toBeGreaterThan(0);
  });

  // Triangulación: env vars explícitas deben respetarse tal cual, mismo
  // criterio que LOGIN_THROTTLE_LIMIT (parsePositiveInt) -- si esto no
  // funcionara, rate-limit-login.e2e-spec.ts tampoco podría probar el 429
  // real para estos dos throttlers en un futuro PR de frontend.
  it('respeta PUBLIC_AVAILABILITY_THROTTLE_LIMIT/TTL explícitos', () => {
    const options = buildAuthThrottlerOptions(
      buildConfig({
        PUBLIC_AVAILABILITY_THROTTLE_LIMIT: '7',
        PUBLIC_AVAILABILITY_THROTTLE_TTL_MS: '12345',
      }),
    );
    const throttlers = getThrottlers(options);
    const availability = throttlers.find(
      (t) => t.name === 'public-availability',
    );
    expect(availability?.limit).toBe(7);
    expect(availability?.ttl).toBe(12345);
  });

  it('respeta PUBLIC_BOOKING_THROTTLE_LIMIT/TTL explícitos', () => {
    const options = buildAuthThrottlerOptions(
      buildConfig({
        PUBLIC_BOOKING_THROTTLE_LIMIT: '3',
        PUBLIC_BOOKING_THROTTLE_TTL_MS: '9999',
      }),
    );
    const throttlers = getThrottlers(options);
    const booking = throttlers.find((t) => t.name === 'public-booking');
    expect(booking?.limit).toBe(3);
    expect(booking?.ttl).toBe(9999);
  });
});

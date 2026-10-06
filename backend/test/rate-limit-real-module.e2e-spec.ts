import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Issue #364: rate limiting contra el AppModule REAL, sin overrideProvider.
 *
 * rate-limit-login.e2e-spec.ts reemplaza las opciones del ThrottlerModule con
 * overrideProvider(getOptionsToken()), y por eso no detectó que los tres
 * ThrottlerModule.forRootAsync (auth, payments, profile) se pisaban entre sí
 * y dejaban a cada guard sin su throttler nombrado (issue #363).
 *
 * Acá los límites se bajan solo por env vars, el mismo mecanismo que usa
 * producción. Cada ruta de abajo pertenece a un módulo distinto, así que si
 * algún módulo vuelve a quedar con las opciones de otro, su test falla.
 */
const LIMIT = 3;

const ENV_OVERRIDES: Record<string, string> = {
  LOGIN_THROTTLE_LIMIT: String(LIMIT),
  EMAIL_CHANGE_CONFIRM_THROTTLE_LIMIT: String(LIMIT),
  PAYMENT_CONFIRM_THROTTLE_LIMIT: String(LIMIT),
};

describe('Rate limiting con el AppModule real, sin override (e2e)', () => {
  let app: INestApplication<App>;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV_OVERRIDES)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // El guard corre antes que el pipe y el servicio: el status de los primeros
  // intentos no importa (401/400), solo que no sea 429 hasta agotar el cupo.
  async function expectLimitEnforced(
    path: string,
    body: Record<string, unknown>,
  ) {
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app.getHttpServer()).post(path).send(body);
      expect(res.status).not.toBe(429);
    }
    const blocked = await request(app.getHttpServer()).post(path).send(body);
    expect(blocked.status).toBe(429);
  }

  it('AuthModule: POST /auth/login responde 429 al superar LOGIN_THROTTLE_LIMIT', async () => {
    await expectLimitEnforced('/api/v1/auth/login', {
      email: `rate-limit.real.${Date.now()}@umbral.cl`,
      password: 'WrongPass123!',
    });
  });

  it('ProfileModule: POST /email-change/confirm responde 429 al superar EMAIL_CHANGE_CONFIRM_THROTTLE_LIMIT', async () => {
    await expectLimitEnforced('/api/v1/profile/email-change/confirm', {
      token: 'bogus-token',
    });
  });

  it('PaymentsModule: POST /payments/confirm responde 429 al superar PAYMENT_CONFIRM_THROTTLE_LIMIT', async () => {
    await expectLimitEnforced('/api/v1/payments/confirm', {
      token: 'bogus-token',
    });
  });
});

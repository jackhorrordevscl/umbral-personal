import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * sdd/patient-self-scheduling PR 3 (tasks.md 3.12): e2e sobre AppModule real
 * (Postgres real, mismo criterio que rate-limit-login.e2e-spec.ts) --
 * confirma que las rutas públicas son alcanzables sin JWT, que responden 429
 * al agotar su propio presupuesto, que un rango de más de 60 días se
 * rechaza, y que los throttlers de auth existentes NO se ven afectados por
 * los dos nombres nuevos ('public-availability'/'public-booking').
 *
 * PUBLIC_SCHEDULING_ENABLED se fuerza a "true" vía process.env ANTES de
 * compilar el AppModule (ConfigModule.forRoot lo lee una sola vez al
 * arrancar) -- jest-e2e.json corre con maxWorkers=1, así que TODOS los specs
 * e2e comparten el mismo proceso Node y por lo tanto el mismo process.env;
 * se restaura el valor original en afterAll para no filtrar este override a
 * otras suites e2e que corran después en la misma corrida.
 */
describe('Public scheduling (e2e)', () => {
  const ORIGINAL_FLAG = process.env.PUBLIC_SCHEDULING_ENABLED;
  // UUID bien formado que no corresponde a ningún User real -- alcanza para
  // probar alcanzabilidad/rate-limiting/validación de rango: computeSlots
  // resuelve con listas vacías para un therapistId inexistente en vez de
  // fallar (mismo criterio defensivo que el resto de AvailabilityService).
  const UNKNOWN_THERAPIST_ID = '00000000-0000-4000-8000-000000000001';

  beforeAll(() => {
    process.env.PUBLIC_SCHEDULING_ENABLED = 'true';
  });

  afterAll(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.PUBLIC_SCHEDULING_ENABLED;
    } else {
      process.env.PUBLIC_SCHEDULING_ENABLED = ORIGINAL_FLAG;
    }
  });

  async function createApp(): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app: INestApplication<App> = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    return app;
  }

  describe('alcanzabilidad sin JWT', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET .../availability responde sin exigir Authorization (no 401)', async () => {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/public/therapists/${UNKNOWN_THERAPIST_ID}/availability?from=2026-09-01T00:00:00-04:00&to=2026-09-05T00:00:00-04:00`,
      );
      expect(response.status).not.toBe(401);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('POST .../availability/book responde sin exigir Authorization (no 401)', async () => {
      const response = await request(app.getHttpServer())
        .post(
          `/api/v1/public/therapists/${UNKNOWN_THERAPIST_ID}/availability/book`,
        )
        .send({
          slotStart: '2099-01-01T13:00:00.000Z',
          patient: {
            fullName: 'Paciente E2E',
            rut: '11.111.111-1',
            birthDate: '1990-01-01',
            email: 'e2e@ejemplo.cl',
          },
        });
      expect(response.status).not.toBe(401);
    });
  });

  describe('validación de rango (span > 60 días rechazado)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('un rango de más de 60 días responde 400', async () => {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/public/therapists/${UNKNOWN_THERAPIST_ID}/availability?from=2026-09-01T00:00:00-04:00&to=2026-12-15T00:00:00-04:00`,
      );
      expect(response.status).toBe(400);
    });

    it('un rango de exactamente 60 días responde 200', async () => {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/public/therapists/${UNKNOWN_THERAPIST_ID}/availability?from=2026-09-01T00:00:00-04:00&to=2026-10-31T00:00:00-04:00`,
      );
      expect(response.status).toBe(200);
    });
  });

  describe('rate limiting (429 al agotar el presupuesto de public-availability)', () => {
    let app: INestApplication<App>;
    const TEST_LIMIT = 2;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(getOptionsToken())
        .useValue({
          throttlers: [
            { name: 'public-availability', limit: TEST_LIMIT, ttl: 60000 },
          ],
        })
        .compile();

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
    });

    it(`permite hasta ${TEST_LIMIT} requests y responde 429 al superar el límite`, async () => {
      const url = `/api/v1/public/therapists/${UNKNOWN_THERAPIST_ID}/availability?from=2026-09-01T00:00:00-04:00&to=2026-09-05T00:00:00-04:00`;
      for (let i = 0; i < TEST_LIMIT; i++) {
        await request(app.getHttpServer()).get(url).expect(200);
      }
      await request(app.getHttpServer()).get(url).expect(429);
    });
  });

  // tasks.md 3.12 "existing auth throttlers unaffected": el riesgo real que
  // este test cubre (el que motivó tratar 3.3 como exhaustividad
  // obligatoria) es que un @SkipThrottle incompleto en una ruta de auth NO
  // rompe con un error obvio -- en cambio, la ruta queda silenciosamente
  // sujeta a TODOS los throttlers no salteados a la vez, y su límite
  // efectivo pasa a ser el MÍNIMO de todos ellos. Por eso el override
  // registra 'login' con un límite generoso (5) JUNTO A 'public-booking' con
  // uno mucho más chico (1) en la MISMA instancia: si a login le faltara
  // saltear 'public-booking' (tasks.md 3.3), la segunda llamada a
  // /auth/login ya respondería 429 (acotada por el límite de 1 de
  // 'public-booking'), en vez de las 5 que login declara soportar.
  describe('los throttlers de auth existentes no se ven afectados', () => {
    let app: INestApplication<App>;
    const LOGIN_LIMIT = 5;
    const PUBLIC_BOOKING_LIMIT = 1;
    const runId = Date.now();
    const UNKNOWN_EMAIL = `public-scheduling-e2e.${runId}@umbral.cl`;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(getOptionsToken())
        .useValue({
          throttlers: [
            { name: 'login', limit: LOGIN_LIMIT, ttl: 60000 },
            {
              name: 'public-booking',
              limit: PUBLIC_BOOKING_LIMIT,
              ttl: 60000,
            },
          ],
        })
        .compile();

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
    });

    it(`POST /auth/login permite sus propios ${LOGIN_LIMIT} intentos, sin quedar acotado por el límite de public-booking (${PUBLIC_BOOKING_LIMIT})`, async () => {
      for (let i = 0; i < LOGIN_LIMIT; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: UNKNOWN_EMAIL, password: 'WrongPass123!' })
          .expect(401);
      }
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: UNKNOWN_EMAIL, password: 'WrongPass123!' })
        .expect(429);
    });
  });
});

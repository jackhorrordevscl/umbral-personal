import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/session-cookie';

/**
 * Issue #387 / ADR 0003: la sesión viaja en una cookie HttpOnly. Estos e2e
 * prueban el ciclo completo contra la base real: emisión al terminar el
 * enrolamiento MFA, autenticación solo con la cookie, limpieza en logout y
 * convivencia con el Bearer durante la transición.
 *
 * Mismo patrón de fixtures y de override de throttlers que
 * session-invalidation.e2e-spec.ts.
 */
describe('Sesión en cookie HttpOnly (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const createdUserIds: string[] = [];

  // Devuelve el accessToken del body y los Set-Cookie crudos de la respuesta
  // que emitió la sesión (mfa/setup/confirm).
  async function createUserAndEnroll(email: string) {
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: 'Cookie Test' },
    });
    createdUserIds.push(user.id);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    const setupToken = (login.body as Record<string, unknown>)
      .setupToken as string;

    // El login no emite sesión: no debe tocar la cookie.
    expect(login.headers['set-cookie']).toBeUndefined();

    const begin = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken })
      .expect(201);
    const totp = speakeasy.totp({
      secret: (begin.body as Record<string, unknown>).secret as string,
      encoding: 'base32',
    });

    const confirm = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken, token: totp })
      .expect(201);

    return {
      accessToken: (confirm.body as Record<string, unknown>)
        .accessToken as string,
      setCookie: confirm.headers['set-cookie'] as unknown as string[],
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getOptionsToken())
      .useValue({
        throttlers: [
          { name: 'login', limit: 1000, ttl: 60000 },
          { name: 'mfa-verify', limit: 1000, ttl: 60000 },
          { name: 'signup', limit: 1000, ttl: 60000 },
          { name: 'mfa-setup', limit: 1000, ttl: 60000 },
          { name: 'password-change', limit: 1000, ttl: 60000 },
          { name: 'verify-email', limit: 1000, ttl: 60000 },
          { name: 'password-reset', limit: 1000, ttl: 60000 },
          { name: 'profile-update', limit: 1000, ttl: 60000 },
          { name: 'email-change-confirm', limit: 1000, ttl: 60000 },
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

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Nunca hard-delete: AuditLog usa onDelete: Restrict sobre userId.
      await prisma.user.updateMany({
        where: { id: { in: createdUserIds } },
        data: { deletedAt: new Date() },
      });
    }
    await app.close();
  });

  it('emite la cookie HttpOnly SameSite=Strict, host-only, y la sesión funciona solo con ella', async () => {
    const { accessToken, setCookie } = await createUserAndEnroll(
      `cookie.issue.${runId}@umbral.cl`,
    );

    const raw = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(raw).toBeDefined();
    expect(raw).toContain(`${SESSION_COOKIE_NAME}=${accessToken}`);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).not.toMatch(/Domain=/i);

    // Solo la cookie, sin Authorization.
    await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${accessToken}`)
      .expect(200);
  });

  it('el Bearer sigue autenticando durante la transición', async () => {
    const { accessToken } = await createUserAndEnroll(
      `cookie.bearer.${runId}@umbral.cl`,
    );

    await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('rechaza una cookie con un token inválido y una petición sin credenciales', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Cookie', `${SESSION_COOKIE_NAME}=no-es-un-jwt`)
      .expect(401);
    await request(app.getHttpServer()).get('/api/v1/profile').expect(401);
  });

  // Issue #487: SameSite=Strict no separa subdominios hermanos; una petición
  // que cambia estado y trae la cookie debe venir del frontend.
  it('una petición con cookie y Origin ajeno se rechaza con 403 y no toca la sesión', async () => {
    const { accessToken } = await createUserAndEnroll(
      `cookie.origin.${runId}@umbral.cl`,
    );
    const cookie = `${SESSION_COOKIE_NAME}=${accessToken}`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://otro-subdominio.example.com')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'same-site')
      .expect(403);

    // La sesión sigue viva: el rechazo ocurre antes de cualquier efecto.
    await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Cookie', cookie)
      .expect(200);

    // Con el Origin del frontend la misma petición sí procede.
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:5173')
      .expect(201);
  });

  it('un Bearer sin cookie no se ve afectado por el Origin', async () => {
    const { accessToken } = await createUserAndEnroll(
      `cookie.bearer.origin.${runId}@umbral.cl`,
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Origin', 'https://otro-subdominio.example.com')
      .expect(201);
  });

  it('logout revoca la sesión en el servidor y limpia la cookie', async () => {
    const { accessToken } = await createUserAndEnroll(
      `cookie.logout.${runId}@umbral.cl`,
    );
    const cookie = `${SESSION_COOKIE_NAME}=${accessToken}`;

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .expect(201);

    const cleared = (logout.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);

    // La sesión quedó revocada: reenviar la misma cookie ya no autentica.
    await request(app.getHttpServer())
      .get('/api/v1/profile')
      .set('Cookie', cookie)
      .expect(401);
  });
});

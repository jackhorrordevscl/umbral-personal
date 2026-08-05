import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Reenvío del link de verificación de email (compliance: login() ya
 * bloqueaba con 401 a una cuenta de signup propio sin verificar, sin
 * ninguna salida self-service si el primer email se perdió o expiró en 24h,
 * ver AuthService.resendVerificationEmail).
 *
 * Mismo patrón anti-enumeración que forgot-reset-password.e2e-spec.ts: la
 * respuesta debe ser idéntica exista o no el email, y esté o no ya
 * verificado -- así no se filtra qué cuentas están registradas ni su estado
 * de verificación.
 *
 * Compila su propia AppModule con throttlers de límite alto vía override de
 * DI (mismo patrón que forgot-reset-password/signup-email-verification),
 * para no compartir presupuesto con las demás suites e2e.
 */
describe('Reenvío de verificación de email (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  const createdUserIds: string[] = [];

  async function createUser(emailPrefix: string, emailVerified: boolean) {
    const email = `${emailPrefix}.${runId}@umbral.cl`;
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: 'Resend Verification Test',
        emailVerified,
      },
    });
    createdUserIds.push(user.id);
    return { email, id: user.id };
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
          { name: 'mfa-recover', limit: 1000, ttl: 60000 },
          { name: 'resend-verification', limit: 1000, ttl: 60000 },
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
      await prisma.user.updateMany({
        where: { id: { in: createdUserIds } },
        data: { deletedAt: new Date() },
      });
    }
    await app.close();
  });

  describe('POST /auth/verify-email/resend', () => {
    it('responde el mismo mensaje genérico para cuenta sin verificar, cuenta ya verificada, y email inexistente', async () => {
      const { email: unverifiedEmail } = await createUser(
        'resend.unverified',
        false,
      );
      const { email: verifiedEmail } = await createUser(
        'resend.verified',
        true,
      );

      const resUnverified = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/resend')
        .send({ email: unverifiedEmail })
        .expect(201);

      const resVerified = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/resend')
        .send({ email: verifiedEmail })
        .expect(201);

      const resMissing = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/resend')
        .send({ email: `no-existe.${runId}@umbral.cl` })
        .expect(201);

      expect(resUnverified.body).toEqual(resVerified.body);
      expect(resUnverified.body).toEqual(resMissing.body);
      expect(
        typeof (resUnverified.body as Record<string, unknown>).message,
      ).toBe('string');
    });

    it('rechaza email inválido (400)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/resend')
        .send({ email: 'no-es-un-email' })
        .expect(400);
    });

    it('no entrega accessToken ni ningún token de sesión', async () => {
      const { email } = await createUser('resend.no-token', false);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/resend')
        .send({ email })
        .expect(201);

      expect((res.body as Record<string, unknown>).accessToken).toBeUndefined();
    });

    it('no modifica emailVerified de la cuenta (solo dispara el email, no verifica nada)', async () => {
      const { email, id } = await createUser('resend.no-mutate', false);

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email/resend')
        .send({ email })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { id } });
      expect(user!.emailVerified).toBe(false);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });
  });
});

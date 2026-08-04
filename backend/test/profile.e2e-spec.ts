import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * #72 (punto 4): ProfileModule no tenía cobertura de tests, ni unit ni e2e,
 * pese a ser la única ruta donde un profesional cambia su propio email o
 * contraseña. Mismo patrón de fixtures que rbac-ownership.e2e-spec.ts:
 * usuarios creados directo vía Prisma + enrolamiento MFA forzado (obligatorio
 * para toda cuenta) antes de tener un accessToken utilizable.
 */
describe('ProfileModule (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let userAId: string;
  let userAToken: string;
  let userAEmail: string;
  let userBEmail: string;

  async function createProfessionalAndLogin(
    email: string,
    name: string,
  ): Promise<{ id: string; token: string }> {
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    expect((login.body as Record<string, unknown>).requiresMfaSetup).toBe(true);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({
        setupToken: (login.body as Record<string, unknown>)
          .setupToken as string,
      })
      .expect(201);

    const totp = speakeasy.totp({
      secret: (beginSetup.body as Record<string, unknown>).secret as string,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({
        setupToken: (login.body as Record<string, unknown>)
          .setupToken as string,
        token: totp,
      })
      .expect(201);

    return {
      id: user.id,
      token: (confirmSetup.body as Record<string, unknown>)
        .accessToken as string,
    };
  }

  beforeAll(async () => {
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

    prisma = app.get(PrismaService);

    userAEmail = `profile.a.${runId}@umbral.cl`;
    userBEmail = `profile.b.${runId}@umbral.cl`;

    const userA = await createProfessionalAndLogin(
      userAEmail,
      'Profile Test A',
    );
    userAId = userA.id;
    userAToken = userA.token;

    // Solo necesita existir en la base (dueña del email "ya registrado" en
    // el test de conflicto) -- no necesita loguear.
    await prisma.user.create({
      data: {
        email: userBEmail,
        passwordHash: await argon2.hash(TEST_PASSWORD),
        name: 'Profile Test B',
      },
    });
  });

  afterAll(async () => {
    try {
      // Nunca hard-delete de User: cada request autenticado durante la
      // suite generó filas en AuditLog, y AuditLog.userId usa
      // onDelete: Restrict a propósito (T2.1, issue #52) -- mismo patrón
      // que rbac-ownership.e2e-spec.ts.
      await prisma.user.updateMany({
        where: {
          email: { in: [userAEmail, userBEmail, `updated.${runId}@umbral.cl`] },
        },
        data: { deletedAt: new Date() },
      });
    } finally {
      await app.close();
    }
  });

  describe('Guard sin token', () => {
    it('GET /profile sin Authorization header devuelve 401', () => {
      return request(app.getHttpServer()).get('/api/v1/profile').expect(401);
    });
  });

  describe('GET /profile', () => {
    it('devuelve los datos propios sin passwordHash', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect((res.body as Record<string, unknown>).id as string).toBe(userAId);
      expect((res.body as Record<string, unknown>).email).toBe(userAEmail);
      expect((res.body as Record<string, unknown>).mfaEnabled).toBe(true);
      expect(
        (res.body as Record<string, unknown>).passwordHash,
      ).toBeUndefined();
    });
  });

  describe('PATCH /profile', () => {
    it('actualiza solo el nombre', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: 'Nombre Actualizado' })
        .expect(200);

      expect((res.body as Record<string, unknown>).name).toBe(
        'Nombre Actualizado',
      );
      expect((res.body as Record<string, unknown>).email).toBe(userAEmail);
    });

    it('actualiza el email a uno nuevo y no usado', async () => {
      const newEmail = `updated.${runId}@umbral.cl`;
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: newEmail })
        .expect(200);

      expect((res.body as Record<string, unknown>).email).toBe(newEmail);

      // Revertir para no interferir con los tests siguientes que asumen userAEmail.
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: userAEmail })
        .expect(200);
    });

    it('rechaza actualizar a un email ya registrado por otra cuenta (409)', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: userBEmail })
        .expect(409);
    });

    it('rechaza un email con formato inválido (400)', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: 'no-es-un-email' })
        .expect(400);
    });

    it('rechaza una password menor a 8 caracteres (400)', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ password: 'corta1' })
        .expect(400);
    });

    it('actualiza la password: el login con la anterior deja de funcionar y con la nueva funciona', async () => {
      const NEW_PASSWORD = 'NuevaPassword789!';

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ password: NEW_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: userAEmail, password: TEST_PASSWORD })
        .expect(401);

      const relogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: userAEmail, password: NEW_PASSWORD })
        .expect(201);
      expect((relogin.body as Record<string, unknown>).requiresMfa).toBe(true);
    });
  });
});

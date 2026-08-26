import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * #72 (punto 4) / #76: ProfileModule -- PATCH /profile ahora exige step-up
 * auth (currentPassword) para cualquier cambio de email/password, y el
 * cambio de email queda diferido vía pendingEmail hasta que se confirma
 * desde la nueva casilla (POST /profile/email-change/confirm). Mismo patrón
 * de fixtures que rbac-ownership.e2e-spec.ts: usuarios creados directo vía
 * Prisma + enrolamiento MFA forzado (obligatorio para toda cuenta) antes de
 * tener un accessToken utilizable.
 *
 * Sin RESEND_API_KEY seteada en el entorno de test, MailService no llama a
 * la API real de Resend: el token de confirmación de email-change se firma
 * a mano acá contra el `pendingEmailTokenIssuedAt` persistido, mismo patrón
 * que forgot-reset-password.e2e-spec.ts con 'password-reset'.
 */
describe('ProfileModule (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  let userAId: string;
  let userAToken: string;
  let userAEmail: string;
  let userBEmail: string;

  const createdUserIds: string[] = [];

  async function createProfessionalAndLogin(
    email: string,
    name: string,
  ): Promise<{ id: string; token: string }> {
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
    });
    createdUserIds.push(user.id);

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

  function signEmailChangeToken(
    sub: string,
    pendingEmail: string,
    changeIssuedAt: number,
    expiresIn: JwtSignOptions['expiresIn'] = '24h',
  ) {
    return jwtService.sign(
      { sub, purpose: 'email-change', pendingEmail, changeIssuedAt },
      { expiresIn },
    );
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
    jwtService = app.get(JwtService);

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
    const userB = await prisma.user.create({
      data: {
        email: userBEmail,
        passwordHash: await argon2.hash(TEST_PASSWORD),
        name: 'Profile Test B',
      },
    });
    createdUserIds.push(userB.id);
  });

  afterAll(async () => {
    try {
      // Nunca hard-delete de User: cada request autenticado durante la
      // suite generó filas en AuditLog, y AuditLog.userId usa
      // onDelete: Restrict a propósito (T2.1, issue #52) -- mismo patrón
      // que rbac-ownership.e2e-spec.ts.
      await prisma.user.updateMany({
        where: { id: { in: createdUserIds } },
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

  describe('PATCH /profile — step-up auth', () => {
    it('actualiza solo el nombre sin requerir currentPassword', async () => {
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

    it('rechaza un cambio de email sin currentPassword (401), sin tocar pendingEmail', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: `no-deberia-aplicar.${runId}@umbral.cl` })
        .expect(401);

      const user = await prisma.user.findUnique({ where: { id: userAId } });
      expect(user!.pendingEmail).toBeNull();
    });

    it('rechaza un cambio de password sin currentPassword (401)', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ password: 'OtraPassword999!' })
        .expect(401);
    });

    it('currentPassword incorrecta rechaza el request completo (401), sin cambiar ni siquiera name', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          name: 'Nombre Que No Debería Aplicarse',
          email: `no-deberia-aplicar.${runId}@umbral.cl`,
          currentPassword: 'contraseña-incorrecta',
        })
        .expect(401);
      expect(res.body).toBeDefined();

      const profile = await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);
      expect((profile.body as Record<string, unknown>).name).not.toBe(
        'Nombre Que No Debería Aplicarse',
      );
    });

    it('rechaza un email con formato inválido (400)', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: 'no-es-un-email', currentPassword: TEST_PASSWORD })
        .expect(400);
    });

    it('rechaza una password menor a 8 caracteres (400)', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ password: 'corta1', currentPassword: TEST_PASSWORD })
        .expect(400);
    });
  });

  describe('PATCH /profile — cambio de email diferido (pendingEmail)', () => {
    it('con currentPassword correcta, deja pendingEmail seteado sin tocar el email activo, y audita EMAIL_CHANGE_REQUESTED', async () => {
      const newEmail = `pending.${runId}@umbral.cl`;

      const res = await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: newEmail, currentPassword: TEST_PASSWORD })
        .expect(200);

      expect((res.body as Record<string, unknown>).email).toBe(userAEmail);
      expect((res.body as Record<string, unknown>).pendingEmail).toBe(newEmail);

      const user = await prisma.user.findUnique({ where: { id: userAId } });
      expect(user!.pendingEmail).toBe(newEmail);
      expect(user!.pendingEmailTokenIssuedAt).not.toBeNull();

      const auditRow = await prisma.auditLog.findFirst({
        where: { userId: userAId, action: 'EMAIL_CHANGE_REQUESTED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.resourceId).toBe(userAId);
      expect(auditRow!.detail).not.toContain(TEST_PASSWORD);

      // Login sigue funcionando con el email ACTIVO (todavía no cambió).
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: userAEmail, password: TEST_PASSWORD })
        .expect(201);
    });

    it('rechaza actualizar a un email ya registrado por otra cuenta (409) y no deja pendingEmail', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ email: userBEmail, currentPassword: TEST_PASSWORD })
        .expect(409);

      const user = await prisma.user.findUnique({ where: { id: userAId } });
      expect(user!.pendingEmail).not.toBe(userBEmail);
    });

    it('camino feliz completo: solicitar + confirmar activa el nuevo email, limpia pendingEmail y audita ambos pasos', async () => {
      const userC = await createProfessionalAndLogin(
        `profile.c.${runId}@umbral.cl`,
        'Profile Test C',
      );
      const newEmail = `confirmed.${runId}@umbral.cl`;

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userC.token}`)
        .send({ email: newEmail, currentPassword: TEST_PASSWORD })
        .expect(200);

      const pending = await prisma.user.findUnique({
        where: { id: userC.id },
      });
      const token = signEmailChangeToken(
        userC.id,
        newEmail,
        pending!.pendingEmailTokenIssuedAt!.getTime(),
      );

      const confirmRes = await request(app.getHttpServer())
        .post('/api/v1/profile/email-change/confirm')
        .send({ token })
        .expect(201);
      expect(typeof (confirmRes.body as Record<string, unknown>).message).toBe(
        'string',
      );

      const confirmed = await prisma.user.findUnique({
        where: { id: userC.id },
      });
      expect(confirmed!.email).toBe(newEmail);
      expect(confirmed!.emailVerified).toBe(true);
      expect(confirmed!.pendingEmail).toBeNull();
      expect(confirmed!.pendingEmailTokenIssuedAt).toBeNull();

      const auditRow = await prisma.auditLog.findFirst({
        where: { userId: userC.id, action: 'EMAIL_CHANGE_CONFIRMED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.resourceId).toBe(userC.id);

      // El login ahora se hace con la dirección NUEVA.
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: newEmail, password: TEST_PASSWORD })
        .expect(201);
      expect((login.body as Record<string, unknown>).requiresMfa).toBe(true);
    });

    it('una segunda solicitud supersede la primera: el token de la primera deja de servir para confirmar', async () => {
      const userD = await createProfessionalAndLogin(
        `profile.d.${runId}@umbral.cl`,
        'Profile Test D',
      );
      const firstEmail = `first.${runId}@umbral.cl`;
      const secondEmail = `second.${runId}@umbral.cl`;

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userD.token}`)
        .send({ email: firstEmail, currentPassword: TEST_PASSWORD })
        .expect(200);
      const firstIssuedAt = (await prisma.user.findUnique({
        where: { id: userD.id },
      }))!.pendingEmailTokenIssuedAt!.getTime();
      const staleToken = signEmailChangeToken(
        userD.id,
        firstEmail,
        firstIssuedAt,
      );

      // Da tiempo real entre ambos pedidos para que el segundo timestamp sea
      // estrictamente distinto al primero (mismo motivo que
      // forgot-reset-password.e2e-spec.ts).
      await new Promise((resolve) => setTimeout(resolve, 5));

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userD.token}`)
        .send({ email: secondEmail, currentPassword: TEST_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/profile/email-change/confirm')
        .send({ token: staleToken })
        .expect(401);

      const user = await prisma.user.findUnique({ where: { id: userD.id } });
      expect(user!.pendingEmail).toBe(secondEmail);
      expect(user!.email).not.toBe(firstEmail);
    });

    it('un token de confirmación expirado no activa el cambio pendiente (401)', async () => {
      const userE = await createProfessionalAndLogin(
        `profile.e.${runId}@umbral.cl`,
        'Profile Test E',
      );
      const newEmail = `expired.${runId}@umbral.cl`;

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userE.token}`)
        .send({ email: newEmail, currentPassword: TEST_PASSWORD })
        .expect(200);
      const issuedAt = (await prisma.user.findUnique({
        where: { id: userE.id },
      }))!.pendingEmailTokenIssuedAt!.getTime();
      const expiredToken = signEmailChangeToken(
        userE.id,
        newEmail,
        issuedAt,
        '-1s',
      );

      await request(app.getHttpServer())
        .post('/api/v1/profile/email-change/confirm')
        .send({ token: expiredToken })
        .expect(401);

      const user = await prisma.user.findUnique({ where: { id: userE.id } });
      expect(user!.email).not.toBe(newEmail);
      expect(user!.pendingEmail).toBe(newEmail);
    });
  });

  describe('PATCH /profile — cambio de password', () => {
    it('actualiza la password: el login con la anterior deja de funcionar, con la nueva funciona, y audita PASSWORD_CHANGED', async () => {
      const NEW_PASSWORD = 'NuevaPassword789!';

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ password: NEW_PASSWORD, currentPassword: TEST_PASSWORD })
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

      const auditRow = await prisma.auditLog.findFirst({
        where: { userId: userAId, action: 'PASSWORD_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.resourceId).toBe(userAId);
      expect(auditRow!.detail).not.toContain(NEW_PASSWORD);

      // Revierte para no interferir con otras suites que puedan reusar este
      // usuario si el runId llegara a colisionar.
      await prisma.user.update({
        where: { id: userAId },
        data: { passwordHash: await argon2.hash(TEST_PASSWORD) },
      });
    });
  });
});

/**
 * Rate limiting de PATCH /profile (issue #76): throttler nombrado propio
 * ('profile-update', ver buildProfileThrottlerOptions en profile.module.ts)
 * -- responde 429 al superar el límite, independiente de si currentPassword
 * es correcta o no. Compila su PROPIA AppModule con límite bajo vía override
 * de DI (mismo patrón que rate-limit-login.e2e-spec.ts), incluyendo todos
 * los throttlers nombrados de AuthModule y ProfileModule con límite alto
 * salvo 'profile-update' -- ambos módulos comparten el mismo token de
 * opciones (getOptionsToken() no está parametrizado por módulo en
 * @nestjs/throttler), así que un único array de throttlers cubre ambos.
 */
describe('Rate limiting en PATCH /profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const TEST_LIMIT = 3;
  const TEST_TTL_MS = 60000;

  const runId = Date.now();
  const email = `profile.throttle.${runId}@umbral.cl`;
  const TEST_PASSWORD = 'TestPass123!';
  let token: string;
  let userId: string;

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
          { name: 'resend-verification', limit: 1000, ttl: 60000 },
          { name: 'password-reset', limit: 1000, ttl: 60000 },
          { name: 'mfa-recover', limit: 1000, ttl: 60000 },
          { name: 'profile-update', limit: TEST_LIMIT, ttl: TEST_TTL_MS },
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

    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: 'Profile Throttle Test' },
    });
    userId = user.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
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
    token = (confirmSetup.body as Record<string, unknown>)
      .accessToken as string;
  });

  afterAll(async () => {
    await prisma.user.updateMany({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
    await app.close();
  });

  it(`permite hasta ${TEST_LIMIT} intentos (currentPassword incorrecta, 401)`, async () => {
    for (let i = 0; i < TEST_LIMIT; i++) {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'OtraPassword999!', currentPassword: 'incorrecta' })
        .expect(401);
    }
  });

  it(`el intento número ${TEST_LIMIT + 1} contra la ruta responde 429, aunque el payload sería válido`, async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nombre Cualquiera' })
      .expect(429);
  });
});

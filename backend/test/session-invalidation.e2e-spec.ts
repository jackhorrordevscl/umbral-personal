import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Issue #76 (PR B): cualquier cambio de contraseña invalida TODO token
 * emitido antes de ese cambio (JwtStrategy.validate() compara `iat` contra
 * `User.passwordChangedAt`), aplicado uniformemente a los tres flujos que
 * cambian la contraseña de una cuenta: PATCH /profile, el reset self-service
 * (POST /auth/password/reset) y el cambio forzado de mustChangePassword
 * (POST /auth/password/change).
 *
 * Mismo patrón de fixtures y de override de throttlers (límite alto, DI
 * local a esta TestingModule) que profile.e2e-spec.ts /
 * forgot-reset-password.e2e-spec.ts, para no compartir presupuesto con las
 * demás suites e2e ni depender de RESEND_API_KEY.
 */
describe('Session invalidation tras cambio de contraseña (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const NEW_PASSWORD = 'NewTestPass456!';

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

  function signResetToken(sub: string, resetIssuedAt: number) {
    return jwtService.sign(
      { sub, purpose: 'password-reset', resetIssuedAt },
      { expiresIn: '30m' },
    );
  }

  // Firma un token de SESIÓN (sin `purpose`, igual al que emite
  // AuthService.generateToken) pero con un `iat` propio en vez del que
  // asignaría jsonwebtoken automáticamente -- necesario para simular "un
  // token emitido antes del cambio" sin depender de un sleep real en el
  // test. OJO: `noTimestamp: true` NO preserva un `iat` ya presente en el
  // payload -- jsonwebtoken lo BORRA incondicionalmente (sign.js: `if
  // (options.noTimestamp) delete payload.iat`), dejando `payload.iat`
  // `undefined` en el token resultante y anulando en silencio el chequeo de
  // JwtStrategy (`undefined < N` es `false`). Sin `noTimestamp`, jsonwebtoken
  // usa `payload.iat` si ya viene seteado (`timestamp = payload.iat || Date.now()`),
  // así que alcanza con NO pasar esa opción.
  function signSessionTokenWithIat(
    sub: string,
    email: string,
    role: string,
    name: string,
    iat: number,
  ) {
    return jwtService.sign({ sub, email, role, name, iat });
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
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Nunca hard-delete: mismo motivo que profile.e2e-spec.ts (AuditLog
      // usa onDelete: Restrict sobre userId).
      await prisma.user.updateMany({
        where: { id: { in: createdUserIds } },
        data: { deletedAt: new Date() },
      });
    }
    await app.close();
  });

  describe('PATCH /profile con cambio de password', () => {
    it('el token emitido ANTES del cambio queda 401 en cualquier request autenticado posterior', async () => {
      const email = `session-inv.profile.${runId}@umbral.cl`;
      const { token: oldToken } = await createProfessionalAndLogin(
        email,
        'Session Invalidation Profile',
      );

      // Confirma que el token era válido antes del cambio.
      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ password: NEW_PASSWORD, currentPassword: TEST_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);
    });

    it('un login posterior con la nueva contraseña emite un token válido (no se autorrechaza)', async () => {
      const email = `session-inv.profile-fresh.${runId}@umbral.cl`;
      const { token: oldToken } = await createProfessionalAndLogin(
        email,
        'Session Invalidation Profile Fresh',
      );

      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ password: NEW_PASSWORD, currentPassword: TEST_PASSWORD })
        .expect(200);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: NEW_PASSWORD })
        .expect(201);
      expect((login.body as Record<string, unknown>).requiresMfa).toBe(true);
    });
  });

  describe('POST /auth/password/reset', () => {
    it('invalida el token en TODOS los dispositivos con sesión activa (dos tokens previos, ambos 401)', async () => {
      const email = `session-inv.reset.${runId}@umbral.cl`;
      const { id, token: deviceAToken } = await createProfessionalAndLogin(
        email,
        'Session Invalidation Reset',
      );
      // Segundo "dispositivo": otro accessToken válido para la misma cuenta,
      // emitido por un login normal (mismo secreto, mismo passwordChangedAt
      // todavía NULL en este punto).
      const deviceBToken = jwtService.sign({
        sub: id,
        email,
        role: 'PROFESSIONAL',
        name: 'Session Invalidation Reset',
      });

      const issuedAt = Date.now();
      await prisma.user.update({
        where: { id },
        data: { passwordResetTokenIssuedAt: new Date(issuedAt) },
      });
      const resetToken = signResetToken(id, issuedAt);

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken, newPassword: NEW_PASSWORD })
        .expect(201);

      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${deviceAToken}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${deviceBToken}`)
        .expect(401);
    });
  });

  describe('POST /auth/password/change (mustChangePassword forzado)', () => {
    it('un token de sesión con iat anterior al cambio forzado queda 401 después de completarlo', async () => {
      const email = `session-inv.force.${runId}@umbral.cl`;
      const passwordHash = await argon2.hash(TEST_PASSWORD);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: 'Session Invalidation Force',
          mustChangePassword: true,
        },
      });
      createdUserIds.push(user.id);

      // Token "viejo" con iat en el pasado: representa cualquier token
      // emitido antes de este cambio forzado (ej. una cuenta reactivada con
      // mustChangePassword tras un incidente, con sesiones previas
      // filtradas). El chequeo de JwtStrategy es genérico sobre iat vs.
      // passwordChangedAt, no depende de CÓMO se emitió el token.
      const oldIat = Math.floor((Date.now() - 60_000) / 1000);
      const oldToken = signSessionTokenWithIat(
        user.id,
        email,
        'PROFESSIONAL',
        'Session Invalidation Force',
        oldIat,
      );

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(201);
      expect(
        (login.body as Record<string, unknown>).requiresPasswordChange,
      ).toBe(true);

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/change')
        .send({
          passwordChangeToken: (login.body as Record<string, unknown>)
            .passwordChangeToken as string,
          newPassword: NEW_PASSWORD,
        })
        .expect(201);

      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);
    });
  });

  describe('Usuario pre-deploy (passwordChangedAt NULL)', () => {
    it('un token vigente sigue siendo válido si la cuenta nunca cambió su contraseña', async () => {
      const email = `session-inv.predeploy.${runId}@umbral.cl`;
      const { token } = await createProfessionalAndLogin(
        email,
        'Session Invalidation Pre Deploy',
      );

      // No se toca la password de esta cuenta -- passwordChangedAt queda
      // NULL, igual que toda la base existente al desplegar esta migración.
      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});

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
 * Issue #50: flujo self-service de recuperación de cuenta por email --
 * hasta ahora, perder la contraseña dejaba las fichas clínicas inaccesibles
 * sin intervención manual en la base de datos (Ley 20.584 art. 12,
 * disponibilidad de la ficha; Ley 21.719, derechos ARCO).
 *
 * Sin RESEND_API_KEY seteada en el entorno de test, MailService no llama a
 * la API real de Resend: el resetToken se firma a mano acá (mismo purpose
 * 'password-reset' que emite AuthService.forgotPassword) para probar el
 * contrato end-to-end real de POST /auth/password/reset, mismo patrón que
 * signup-email-verification.e2e-spec.ts con 'email-verify'.
 *
 * Compila su propia AppModule con throttlers de límite alto vía override de
 * DI (mismo patrón que signup-email-verification.e2e-spec.ts) para no
 * compartir presupuesto con las demás suites e2e.
 */
describe('Forgot/reset password (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const NEW_PASSWORD = 'NewTestPass456!';

  const createdUserIds: string[] = [];

  async function createVerifiedUser(emailPrefix: string) {
    const email = `${emailPrefix}.${runId}@umbral.cl`;
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: 'Reset Password Test' },
    });
    createdUserIds.push(user.id);
    return { email, id: user.id };
  }

  function signResetToken(sub: string, resetIssuedAt: number) {
    return jwtService.sign(
      { sub, purpose: 'password-reset', resetIssuedAt },
      { expiresIn: '30m' },
    );
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
      await prisma.user.updateMany({
        where: { id: { in: createdUserIds } },
        data: { deletedAt: new Date() },
      });
    }
    await app.close();
  });

  describe('POST /auth/password/forgot', () => {
    it('responde el mismo mensaje genérico exista o no la cuenta (no filtra existencia)', async () => {
      const { email } = await createVerifiedUser('forgot.existing');

      const resExisting = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);

      const resMissing = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email: `no-existe.${runId}@umbral.cl` })
        .expect(201);

      expect(resExisting.body).toEqual(resMissing.body);
      expect(typeof resExisting.body.message).toBe('string');
    });

    it('rechaza email inválido (400)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'no-es-un-email' })
        .expect(400);
    });

    it('persiste passwordResetTokenIssuedAt para una cuenta existente', async () => {
      const { email, id } = await createVerifiedUser('forgot.persist');

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { id } });
      expect(user!.passwordResetTokenIssuedAt).not.toBeNull();
    });
  });

  describe('POST /auth/password/reset', () => {
    it('token inválido devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: 'esto-no-es-un-jwt-valido', newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('rechaza contraseña nueva menor a 8 caracteres (400)', async () => {
      const { id } = await createVerifiedUser('reset.short');
      const token = signResetToken(id, Date.now());

      return request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: token, newPassword: 'corta1' })
        .expect(400);
    });

    it('rechaza un token sin resetIssuedAt pendiente en la cuenta (nunca se pidió forgot-password)', async () => {
      const { id } = await createVerifiedUser('reset.no-pending');
      const token = signResetToken(id, Date.now());

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: token, newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('camino feliz: cambia la contraseña, no emite accessToken, y permite loguear con la nueva clave', async () => {
      const { email, id } = await createVerifiedUser('reset.happy');

      const forgotRes = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);
      expect(forgotRes.body.accessToken).toBeUndefined();

      const user = await prisma.user.findUnique({ where: { id } });
      const token = signResetToken(id, user!.passwordResetTokenIssuedAt!.getTime());

      const resetRes = await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: token, newPassword: NEW_PASSWORD })
        .expect(201);
      expect(resetRes.body.accessToken).toBeUndefined();
      expect(typeof resetRes.body.message).toBe('string');

      // La contraseña vieja ya no sirve.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(401);

      // La contraseña nueva sí, y el login sigue exigiendo enrolar/pasar MFA
      // -- el reset no bypasea ningún factor.
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: NEW_PASSWORD })
        .expect(201);
      expect(loginRes.body.requiresMfaSetup).toBe(true);
    });

    it('reusar el mismo resetToken tras usarlo rechaza con 401 (replay guard)', async () => {
      const { email, id } = await createVerifiedUser('reset.replay');

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { id } });
      const token = signResetToken(id, user!.passwordResetTokenIssuedAt!.getTime());

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: token, newPassword: NEW_PASSWORD })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: token, newPassword: 'OtraClaveNueva789!' })
        .expect(401);
    });

    it('pedir un segundo forgot-password invalida el link del primero', async () => {
      const { email, id } = await createVerifiedUser('reset.superseded');

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);
      const firstIssuedAt = (await prisma.user.findUnique({ where: { id } }))!
        .passwordResetTokenIssuedAt!.getTime();
      const staleToken = signResetToken(id, firstIssuedAt);

      // Simula que pasa tiempo real entre ambos pedidos, para que el segundo
      // timestamp sea estrictamente distinto al primero.
      await new Promise((resolve) => setTimeout(resolve, 5));

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: staleToken, newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('resetToken usado como Bearer de sesión devuelve 401', async () => {
      const { email, id } = await createVerifiedUser('reset.bearer');

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);
      const user = await prisma.user.findUnique({ where: { id } });
      const token = signResetToken(id, user!.passwordResetTokenIssuedAt!.getTime());

      await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('reset de una cuenta con MFA habilitado sigue exigiendo MFA en el próximo login', async () => {
      const { email, id } = await createVerifiedUser('reset.mfa');

      // Enrola MFA antes del reset.
      const bootstrapLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(201);
      const beginSetup = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({ setupToken: bootstrapLogin.body.setupToken })
        .expect(201);
      const totp = speakeasy.totp({ secret: beginSetup.body.secret, encoding: 'base32' });
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/confirm')
        .send({ setupToken: bootstrapLogin.body.setupToken, token: totp })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(201);
      const user = await prisma.user.findUnique({ where: { id } });
      const token = signResetToken(id, user!.passwordResetTokenIssuedAt!.getTime());

      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .send({ resetToken: token, newPassword: NEW_PASSWORD })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: NEW_PASSWORD })
        .expect(201);

      // requiresMfa (no requiresMfaSetup): MFA sigue habilitado, el reset no
      // lo desactivó ni lo bypaseó.
      expect(loginRes.body.requiresMfa).toBe(true);
      expect(loginRes.body.accessToken).toBeUndefined();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Issue #5: signup propio con verificación de email. Único componente
 * genuinamente nuevo del MVP -- en la versión institucional las cuentas las
 * creaba un ADMIN (POST /users, eliminado en b0354c0); sin jerarquía no hay
 * quién las cree, así que cada profesional se registra solo.
 *
 * Sin RESEND_API_KEY seteada en el entorno de test, MailService no llama a
 * la API real de Resend (ver mail.service.ts): el token de verificación se
 * extrae directo de la respuesta de POST /auth/signup en vez de leerlo de un
 * email real, así esta suite corre sin depender de un proveedor externo ni
 * de credenciales.
 *
 * Compila su propia AppModule (mismo patrón que
 * rate-limit-login.e2e-spec.ts) con un throttler 'signup' de límite alto vía
 * override de DI, para no compartir presupuesto con las demás suites e2e
 * que también compilan AppModule y podrían agotarlo entre corridas.
 */
describe('Signup + verificación de email (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  const createdEmails: string[] = [];

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
    if (createdEmails.length > 0) {
      await prisma.user.updateMany({
        where: { email: { in: createdEmails } },
        data: { deletedAt: new Date() },
      });
    }
    await app.close();
  });

  describe('POST /auth/signup', () => {
    it('crea la cuenta con emailVerified=false y no entrega ningún token de sesión', async () => {
      const email = `signup.${runId}@umbral.cl`;
      createdEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: TEST_PASSWORD, name: 'Nueva Profesional' })
        .expect(201);

      expect(typeof res.body.message).toBe('string');
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.setupToken).toBeUndefined();

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user!.emailVerified).toBe(false);
      expect(user!.role).toBe('PROFESSIONAL');
    });

    it('rechaza un email ya registrado (409)', async () => {
      const email = `signup.dup.${runId}@umbral.cl`;
      createdEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: TEST_PASSWORD, name: 'Primera Vez' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: TEST_PASSWORD, name: 'Segunda Vez' })
        .expect(409);
    });

    it('rechaza contraseña menor a 8 caracteres (400)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: `signup.short.${runId}@umbral.cl`, password: 'corta1', name: 'Test' })
        .expect(400);
    });

    it('rechaza email inválido (400)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: 'no-es-un-email', password: TEST_PASSWORD, name: 'Test' })
        .expect(400);
    });
  });

  describe('login antes de verificar el email', () => {
    it('rechaza con 401 aunque la contraseña sea correcta', async () => {
      const email = `signup.unverified.${runId}@umbral.cl`;
      createdEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: TEST_PASSWORD, name: 'Sin Verificar' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(401);
    });
  });

  describe('POST /auth/verify-email', () => {
    it('token inválido devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token: 'esto-no-es-un-jwt-valido' })
        .expect(401);
    });

    it('verifica la cuenta y permite loguear después (camino feliz completo)', async () => {
      const email = `signup.verify.${runId}@umbral.cl`;
      createdEmails.push(email);

      // El controller no expone el verifyUrl (solo va por email real vía
      // Resend, salteado en test por falta de RESEND_API_KEY): se firma acá
      // el mismo token que emitiría AuthService.signup (purpose
      // 'email-verify', sub del user recién creado) para probar el
      // contrato end-to-end real de POST /auth/verify-email.
      const signupRes = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: TEST_PASSWORD, name: 'Verificación Completa' })
        .expect(201);
      expect(signupRes.body.message).toBeDefined();

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user!.emailVerified).toBe(false);

      const jwtService = app.get(JwtService);
      const token = jwtService.sign(
        { sub: user!.id, purpose: 'email-verify' },
        { expiresIn: '24h' },
      );

      const verifyRes = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token })
        .expect(201);
      expect(verifyRes.body.message).toBeDefined();

      const verifiedUser = await prisma.user.findUnique({ where: { email } });
      expect(verifiedUser!.emailVerified).toBe(true);

      // Ahora el login avanza al flujo normal (MFA obligatorio para toda
      // cuenta): ya no lo bloquea emailVerified.
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(201);
      expect(loginRes.body.requiresMfaSetup).toBe(true);
    });

    it('reusar el mismo token tras verificar rechaza con 401 (replay guard)', async () => {
      const email = `signup.replay.${runId}@umbral.cl`;
      createdEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: TEST_PASSWORD, name: 'Replay Guard' })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { email } });
      const jwtService = app.get(JwtService);
      const token = jwtService.sign(
        { sub: user!.id, purpose: 'email-verify' },
        { expiresIn: '24h' },
      );

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-email')
        .send({ token })
        .expect(401);
    });

    it('token de verificación usado como Bearer de sesión devuelve 401', async () => {
      const email = `signup.bearer.${runId}@umbral.cl`;
      createdEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: TEST_PASSWORD, name: 'Bearer Guard' })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { email } });
      const jwtService = app.get(JwtService);
      const token = jwtService.sign(
        { sub: user!.id, purpose: 'email-verify' },
        { expiresIn: '24h' },
      );

      await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });
});

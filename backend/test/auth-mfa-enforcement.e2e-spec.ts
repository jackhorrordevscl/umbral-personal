import * as dotenv from 'dotenv';
dotenv.config();
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from '../prisma/seed-admin.defaults';

/**
 * T4.1 (issue #19): un usuario ADMIN/SUPERVISOR sin MFA habilitado no puede
 * quedarse con una sesión activa sin MFA. login() ya no le entrega un
 * accessToken directo: entrega un setupToken de corta duración (purpose
 * 'mfa-setup') que solo sirve para /auth/mfa/setup/begin y
 * /auth/mfa/setup/confirm — nunca el userId crudo, y nunca utilizable como
 * Bearer token de sesión (jwt.strategy.ts lo rechaza explícitamente).
 *
 * Los fixtures se crean con emails únicos por corrida (sufijo Date.now())
 * para que la suite sea repetible sobre la misma base, y se limpian en
 * afterAll.
 *
 * ADMIN_EMAIL/ADMIN_PASSWORD son las credenciales del ADMIN seedeado por
 * prisma/seed.ts. Se leen de env (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, que
 * CI fija explícitamente) y caen al MISMO default que usa el seed cuando no
 * están seteadas — así la suite corre en local sin configuración previa y
 * nunca queda desalineada con lo que seedea la base. El literal vive en
 * prisma/seed-admin.defaults.ts (no acá) para no disparar el secret scanning
 * (GitGuardian) en cada PR que toque este spec.
 */
describe('MFA enforcement para roles administrativos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
  const ADMIN_PASSWORD =
    process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;
  const TEST_PASSWORD = 'TestPass123!';

  let adminSetupToken: string;
  let bootstrapAdminToken: string;

  let therapistId: string;
  let therapistEmail: string;

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

    // Se resetea el estado MFA y mustChangePassword del ADMIN seedeado para
    // que esta suite sea determinística sin importar corridas previas — esta
    // suite prueba el enrolamiento MFA forzado (T4.1), no el cambio de
    // contraseña forzado (T4.4, ver auth-force-password-change.e2e-spec.ts).
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mfaEnabled: false, mfaSecret: null, mustChangePassword: false },
    });

    // Se necesita un accessToken de ADMIN para crear el fixture THERAPIST
    // vía POST /users. Se completa el enrolamiento forzado una vez acá,
    // fuera de los `it` que prueban el flujo en sí mismos.
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken: adminLogin.body.setupToken })
      .expect(201);

    const adminTotp = speakeasy.totp({
      secret: beginSetup.body.secret,
      encoding: 'base32',
    });

    const confirmSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken: adminLogin.body.setupToken, token: adminTotp })
      .expect(201);
    bootstrapAdminToken = confirmSetup.body.accessToken;

    // Fixture THERAPIST: no debería sufrir la fricción de MFA obligatorio.
    therapistEmail = `mfa.therapist.${runId}@umbral.cl`;
    const therapistCreate = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${bootstrapAdminToken}`)
      .send({
        email: therapistEmail,
        password: TEST_PASSWORD,
        name: 'MFA Therapist',
        role: 'THERAPIST',
      })
      .expect(201);
    therapistId = therapistCreate.body.id;
  });

  afterAll(async () => {
    try {
      // Guard explícito: si beforeAll falló antes de crear el fixture,
      // therapistId queda undefined. Un `where: { id: undefined }` en
      // Prisma NO significa "no matchear nada" — significa "sin filtro en
      // ese campo", así que updateMany() afectaría a TODOS los usuarios.
      // Sin este guard, un beforeAll fallido soft-borra la tabla User
      // entera (incluido el ADMIN seedeado).
      if (therapistId) {
        await prisma.user.updateMany({
          where: { id: therapistId },
          data: { deletedAt: new Date() },
        });
      }

      // El último test de la suite deja al admin con mfaEnabled=true (y un
      // mfaSecret generado por speakeasy, inservible fuera del test). Sin
      // este reset, esa suite deja el admin seedeado inutilizable para
      // cualquiera que loguee después con una app autenticadora real —
      // tanto en un dev local haciendo login manual como en otra suite que
      // asuma MFA deshabilitado por defecto (rbac-ownership.e2e-spec.ts, por
      // ejemplo, ya lo resetea por su cuenta antes de usarlo, así que este
      // reset no le hace falta a ella — es para dejar la base consistente
      // después de correr esta suite).
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });
    } finally {
      await app.close();
    }
  });

  describe('login de ADMIN/SUPERVISOR sin MFA', () => {
    it('responde requiresMfaSetup con setupToken y NO devuelve accessToken', async () => {
      // Se resetea de nuevo: el beforeAll ya dejó al admin con mfaEnabled=true
      // al completar el bootstrap.
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(201);

      expect(res.body.requiresMfaSetup).toBe(true);
      expect(typeof res.body.setupToken).toBe('string');
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.userId).toBeUndefined();

      adminSetupToken = res.body.setupToken;
    });
  });

  describe('/auth/mfa/setup/begin con setupToken inválido', () => {
    it('token con firma inválida devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({ setupToken: 'esto-no-es-un-jwt-valido' })
        .expect(401);
    });

    it('un accessToken normal (purpose distinto) devuelve 401', async () => {
      // El bootstrapAdminToken es un accessToken de sesión real, no un
      // setupToken: no debe servir para (re)iniciar el enrolamiento.
      return request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({ setupToken: bootstrapAdminToken })
        .expect(401);
    });
  });

  describe('flujo completo de enrolamiento forzado', () => {
    it('begin -> confirm con TOTP válido entrega accessToken y deja mfaEnabled=true', async () => {
      expect(adminSetupToken).toBeDefined();

      const beginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({ setupToken: adminSetupToken })
        .expect(201);

      expect(typeof beginRes.body.secret).toBe('string');
      expect(typeof beginRes.body.qrCode).toBe('string');

      const totp = speakeasy.totp({
        secret: beginRes.body.secret,
        encoding: 'base32',
      });

      const confirmRes = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/confirm')
        .send({ setupToken: adminSetupToken, token: totp })
        .expect(201);

      expect(typeof confirmRes.body.accessToken).toBe('string');
      expect(confirmRes.body.user.email).toBe(ADMIN_EMAIL);

      const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
      expect(admin?.mfaEnabled).toBe(true);
    });

    it('reusar el mismo setupToken tras enrolar rechaza con 401 (no permite retomar la cuenta)', async () => {
      // adminSetupToken ya se consumió en el test anterior: mfaEnabled quedó
      // en true. Un setupToken es un JWT sin estado, válido hasta que expira
      // (10 min) — sin este chequeo, reutilizarlo regeneraría el secreto TOTP
      // y permitiría tomar la cuenta sin la contraseña.
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({ setupToken: adminSetupToken })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/confirm')
        .send({ setupToken: adminSetupToken, token: '000000' })
        .expect(401);
    });
  });

  describe('login de THERAPIST/COORDINATOR sin MFA', () => {
    it('sigue funcionando sin fricción: accessToken directo', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: therapistEmail, password: TEST_PASSWORD })
        .expect(201);

      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.requiresMfaSetup).toBeUndefined();
      expect(res.body.requiresMfa).toBeUndefined();
    });
  });

  describe('setupToken usado como Bearer token de sesión', () => {
    it('GET /patients con setupToken como Bearer devuelve 401', async () => {
      // Se genera un setupToken fresco (el usado arriba ya se consumió
      // implícitamente al dejar mfaEnabled=true en el usuario).
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(201);

      const freshSetupToken = loginRes.body.setupToken;
      expect(typeof freshSetupToken).toBe('string');

      await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${freshSetupToken}`)
        .expect(401);

      // Se deja al admin enrolado de nuevo para ejercitar setupToken/Bearer
      // en el estado que el test anterior dejaba (mfaEnabled=true): el
      // afterAll de la suite es quien se encarga de la limpieza final para
      // quien use este usuario seedeado después.
      const beginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({ setupToken: freshSetupToken })
        .expect(201);
      const totp = speakeasy.totp({ secret: beginRes.body.secret, encoding: 'base32' });
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/confirm')
        .send({ setupToken: freshSetupToken, token: totp })
        .expect(201);
    });
  });
});

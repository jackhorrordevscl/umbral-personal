import * as dotenv from 'dotenv';
dotenv.config();
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * T4.1 (issue #19), reescrito para el modelo de un solo rol (issue #7): tras
 * colapsar los roles a un único PROFESSIONAL (b0354c0), MFA es obligatorio
 * para TODA cuenta, no solo para roles administrativos -- el único rol de
 * este producto maneja el 100% de los datos clínicos propios. login() no le
 * entrega un accessToken directo a nadie sin MFA: entrega un setupToken de
 * corta duración (purpose 'mfa-setup') que solo sirve para
 * /auth/mfa/setup/begin y /auth/mfa/setup/confirm — nunca el userId crudo, y
 * nunca utilizable como Bearer token de sesión (jwt.strategy.ts lo rechaza
 * explícitamente).
 *
 * No existe POST /users tras el colapso de roles (era CRUD institucional,
 * reemplazado por ProfileModule): el fixture PROFESSIONAL se crea directo
 * vía Prisma con argon2, igual que hace seed.ts.
 *
 * ADMIN_EMAIL/ADMIN_PASSWORD son las credenciales del admin seedeado por
 * prisma/seed.ts. Se leen de env (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, que
 * CI fija explícitamente) y caen al MISMO default que usa el seed cuando no
 * están seteadas — así la suite corre en local sin configuración previa y
 * nunca queda desalineada con lo que seedea la base. El literal vive en
 * prisma/seed-admin.defaults.ts (no acá) para no disparar el secret scanning
 * (GitGuardian) en cada PR que toque este spec.
 */
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from '../prisma/seed-admin.defaults';

describe('MFA enforcement obligatorio (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
  const ADMIN_PASSWORD =
    process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;
  const TEST_PASSWORD = 'TestPass123!';

  let adminSetupToken: string;

  let secondUserId: string;
  let secondUserEmail: string;

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

    // Se resetea el estado MFA y mustChangePassword del admin seedeado para
    // que esta suite sea determinística sin importar corridas previas.
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mfaEnabled: false, mfaSecret: null, mustChangePassword: false },
    });

    // Fixture PROFESSIONAL: creado directo vía Prisma (no existe POST /users
    // tras el colapso de roles), sirve para probar que el segundo usuario de
    // la suite sufre exactamente la misma fricción de MFA que el admin
    // seedeado -- ya no hay ningún rol exento.
    secondUserEmail = `mfa.second.${runId}@umbral.cl`;
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const secondUser = await prisma.user.create({
      data: { email: secondUserEmail, passwordHash, name: 'MFA Second User' },
    });
    secondUserId = secondUser.id;
  });

  afterAll(async () => {
    try {
      // Guard explícito: si beforeAll falló antes de crear el fixture,
      // secondUserId queda undefined. Un `where: { id: undefined }` en
      // Prisma NO significa "no matchear nada" — significa "sin filtro en
      // ese campo", así que updateMany() afectaría a TODOS los usuarios.
      if (secondUserId) {
        await prisma.user.updateMany({
          where: { id: secondUserId },
          data: { deletedAt: new Date() },
        });
      }

      // El último test de la suite deja al admin con mfaEnabled=true (y un
      // mfaSecret generado por speakeasy, inservible fuera del test). Sin
      // este reset, esa suite deja el admin seedeado inutilizable para
      // cualquiera que loguee después con una app autenticadora real.
      await prisma.user.updateMany({
        where: { email: ADMIN_EMAIL },
        data: { mfaEnabled: false, mfaSecret: null },
      });
    } finally {
      await app.close();
    }
  });

  describe('login sin MFA habilitado', () => {
    it('responde requiresMfaSetup con setupToken y NO devuelve accessToken (admin seedeado)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(201);

      expect((res.body as Record<string, unknown>).requiresMfaSetup).toBe(true);
      expect(
        typeof (res.body as Record<string, unknown>).setupToken as string,
      ).toBe('string');
      expect(
        (res.body as Record<string, unknown>).accessToken as string,
      ).toBeUndefined();
      expect((res.body as Record<string, unknown>).userId).toBeUndefined();

      adminSetupToken = (res.body as Record<string, unknown>)
        .setupToken as string;
    });

    it('responde requiresMfaSetup también para una cuenta recién creada, sin excepción de rol', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: secondUserEmail, password: TEST_PASSWORD })
        .expect(201);

      expect((res.body as Record<string, unknown>).requiresMfaSetup).toBe(true);
      expect(
        typeof (res.body as Record<string, unknown>).setupToken as string,
      ).toBe('string');
      expect(
        (res.body as Record<string, unknown>).accessToken as string,
      ).toBeUndefined();
    });
  });

  describe('/auth/mfa/setup/begin con setupToken inválido', () => {
    it('token con firma inválida devuelve 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({ setupToken: 'esto-no-es-un-jwt-valido' })
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

      expect(
        typeof (beginRes.body as Record<string, unknown>).secret as string,
      ).toBe('string');
      expect(typeof (beginRes.body as Record<string, unknown>).qrCode).toBe(
        'string',
      );

      const totp = speakeasy.totp({
        secret: (beginRes.body as Record<string, unknown>).secret as string,
        encoding: 'base32',
      });

      const confirmRes = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/confirm')
        .send({ setupToken: adminSetupToken, token: totp })
        .expect(201);

      expect(
        typeof (confirmRes.body as Record<string, unknown>)
          .accessToken as string,
      ).toBe('string');
      expect(
        (
          (confirmRes.body as Record<string, unknown>).user as Record<
            string,
            unknown
          >
        ).email,
      ).toBe(ADMIN_EMAIL);

      const admin = await prisma.user.findUnique({
        where: { email: ADMIN_EMAIL },
      });
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

  describe('setupToken usado como Bearer token de sesión', () => {
    it('GET /patients con setupToken como Bearer devuelve 401', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: secondUserEmail, password: TEST_PASSWORD })
        .expect(201);

      const freshSetupToken = (loginRes.body as Record<string, unknown>)
        .setupToken as string;
      expect(typeof freshSetupToken).toBe('string');

      await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${freshSetupToken}`)
        .expect(401);
    });
  });
});

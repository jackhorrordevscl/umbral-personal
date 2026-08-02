import * as dotenv from 'dotenv';
dotenv.config();
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SEED_ADMIN_EMAIL_DEFAULT,
  SEED_ADMIN_PASSWORD_DEFAULT,
} from '../prisma/seed-admin.defaults';

/**
 * T4.4 (issue #22): el admin semilla (mustChangePassword=true) no puede
 * operar con la contraseña conocida públicamente (seed.ts está en un repo
 * público). login() no le entrega accessToken ni setupToken de MFA: entrega
 * un passwordChangeToken de corta duración (purpose 'password-change') que
 * solo sirve para /auth/password/change — nunca utilizable como Bearer
 * token de sesión (jwt.strategy.ts lo rechaza explícitamente, igual que el
 * setupToken de MFA).
 *
 * ADMIN_EMAIL/ADMIN_PASSWORD se leen de env con fallback al mismo default que
 * el seed (ver auth-mfa-enforcement.e2e-spec.ts y prisma/seed-admin.defaults.ts):
 * corre en local sin configuración y sin repetir el literal acá, evitando los
 * falsos positivos de secret scanning.
 */
describe('Cambio de contraseña forzado del admin semilla (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? SEED_ADMIN_EMAIL_DEFAULT;
  const ADMIN_PASSWORD =
    process.env.SEED_ADMIN_PASSWORD ?? SEED_ADMIN_PASSWORD_DEFAULT;
  const NEW_PASSWORD = 'NewStrongPass456!';

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

    // Se resetea el estado del ADMIN seedeado (password original + flag en
    // true) para que esta suite sea determinística sin importar corridas
    // previas que ya hayan cambiado la contraseña.
    const passwordHash = await argon2.hash(ADMIN_PASSWORD);
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: {
        passwordHash,
        mustChangePassword: true,
        mfaEnabled: false,
        mfaSecret: null,
      },
    });
  });

  afterAll(async () => {
    // Esta suite CAMBIA la contraseña real del admin seedeado (compartido
    // con auth-mfa-enforcement.e2e-spec.ts y rbac-ownership.e2e-spec.ts, que
    // asumen ADMIN_PASSWORD). Sin restaurar el hash acá, cualquier suite que
    // corra después de esta se rompe con 401 al intentar loguear con la
    // contraseña original.
    const originalPasswordHash = await argon2.hash(ADMIN_PASSWORD);
    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { passwordHash: originalPasswordHash, mustChangePassword: false },
    });
    await app.close();
  });

  it('login del admin semilla responde requiresPasswordChange con passwordChangeToken, sin accessToken', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);

    expect(res.body.requiresPasswordChange).toBe(true);
    expect(typeof res.body.passwordChangeToken).toBe('string');
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.requiresMfaSetup).toBeUndefined();
  });

  it('POST /auth/password/change con token inválido devuelve 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/change')
      .send({ passwordChangeToken: 'esto-no-es-un-jwt-valido', newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('POST /auth/password/change con un accessToken normal (purpose distinto) devuelve 401', async () => {
    // Un accessToken de sesión real (de un THERAPIST, que no requiere MFA ni
    // cambio de contraseña) no debe servir para forzar un cambio de
    // contraseña: nunca tuvo purpose 'password-change'.
    const therapistEmail = `force-password.therapist.${Date.now()}@umbral.cl`;
    const therapistPasswordHash = await argon2.hash('TestPass123!');
    await prisma.user.create({
      data: {
        email: therapistEmail,
        passwordHash: therapistPasswordHash,
        name: 'Force Password Test Therapist',
        role: 'THERAPIST',
      },
    });

    const therapistLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: therapistEmail, password: 'TestPass123!' })
      .expect(201);
    expect(typeof therapistLogin.body.accessToken).toBe('string');

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/change')
      .send({ passwordChangeToken: therapistLogin.body.accessToken, newPassword: NEW_PASSWORD })
      .expect(401);

    await prisma.user.updateMany({
      where: { email: therapistEmail },
      data: { deletedAt: new Date() },
    });
  });

  it('passwordChangeToken como Bearer de sesión devuelve 401 en una ruta protegida', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${loginRes.body.passwordChangeToken}`)
      .expect(401);
  });

  it('cambio completo: nueva contraseña deja mustChangePassword=false y entrega requiresMfaSetup (ADMIN sin MFA)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);

    const changeRes = await request(app.getHttpServer())
      .post('/api/v1/auth/password/change')
      .send({ passwordChangeToken: loginRes.body.passwordChangeToken, newPassword: NEW_PASSWORD })
      .expect(201);

    // ADMIN es rol MFA_REQUIRED y todavía no tiene MFA habilitado: la
    // continuación (completeLogin) debe pedir enrolamiento, no dar sesión.
    expect(changeRes.body.requiresMfaSetup).toBe(true);
    expect(typeof changeRes.body.setupToken).toBe('string');

    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    expect(admin?.mustChangePassword).toBe(false);

    // La contraseña vieja ya no sirve.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(401);

    // La nueva sí, y ya no pide cambio de contraseña.
    const reLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: NEW_PASSWORD })
      .expect(201);
    expect(reLogin.body.requiresPasswordChange).toBeUndefined();
  });

  it('reusar un passwordChangeToken después de un cambio ya completado rechaza con 401 (no permite retomar la cuenta)', async () => {
    // El admin ya cambió su contraseña en el test anterior (mustChangePassword
    // quedó en false). Un token viejo (emitido antes de ese cambio) no debe
    // servir para forzar OTRO cambio y tomar la cuenta.
    const staleLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: NEW_PASSWORD })
      .expect(201);
    // El admin ya tiene mustChangePassword=false, así que este login entrega
    // requiresMfaSetup — necesitamos un passwordChangeToken viejo real para
    // esta prueba, no uno nuevo (login ya no emite uno). Se resetea el flag
    // a mano para emitir un token de prueba, se lo usa una vez, y se vuelve
    // a dejar en false para simular el token "viejo" reusado después.
    expect(staleLoginRes.body.requiresMfaSetup).toBe(true);

    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mustChangePassword: true },
    });
    const tokenIssuedWhileTrue = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: NEW_PASSWORD })
      .expect(201);
    const staleToken = tokenIssuedWhileTrue.body.passwordChangeToken;

    await prisma.user.updateMany({
      where: { email: ADMIN_EMAIL },
      data: { mustChangePassword: false },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/change')
      .send({ passwordChangeToken: staleToken, newPassword: 'AnotherPass789!' })
      .expect(401);
  });
});

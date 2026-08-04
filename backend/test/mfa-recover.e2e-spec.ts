import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Issue #50: recovery codes de MFA. Antes de esto, POST /auth/mfa/disable
 * exigía un TOTP válido del mismo secreto -- perder el dispositivo dejaba a
 * disableMfa en un círculo cerrado, sin salida sin intervención manual en la
 * base de datos.
 *
 * Compila su propia AppModule con throttlers de límite alto vía override de
 * DI (mismo patrón que forgot-reset-password.e2e-spec.ts).
 */
describe('MFA recovery codes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';

  const createdUserIds: string[] = [];

  async function createUserWithMfaEnabled(emailPrefix: string) {
    const email = `${emailPrefix}.${runId}@umbral.cl`;
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: 'MFA Recovery Test' },
    });
    createdUserIds.push(user.id);

    const bootstrapLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);

    const beginSetup = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({
        setupToken: (bootstrapLogin.body as Record<string, unknown>)
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
        setupToken: (bootstrapLogin.body as Record<string, unknown>)
          .setupToken as string,
        token: totp,
      })
      .expect(201);

    return {
      email,
      id: user.id,
      recoveryCodes: (confirmSetup.body as Record<string, unknown>)
        .recoveryCodes as string[],
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
          { name: 'mfa-recover', limit: 1000, ttl: 60000 },
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

  describe('POST /auth/mfa/setup/confirm', () => {
    it('devuelve 10 recovery codes únicos junto con el accessToken', async () => {
      const { recoveryCodes } = await createUserWithMfaEnabled('confirm.codes');

      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
    });
  });

  describe('POST /auth/mfa/recover', () => {
    it('rechaza con 401 genérico si el email no existe', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({
          email: `no-existe.${runId}@umbral.cl`,
          password: TEST_PASSWORD,
          recoveryCode: 'aaaa-bbbb',
        })
        .expect(401);
    });

    it('rechaza con 401 si la contraseña es incorrecta', async () => {
      const { email } = await createUserWithMfaEnabled('recover.badpass');

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({
          email,
          password: 'ClaveIncorrecta1!',
          recoveryCode: 'aaaa-bbbb',
        })
        .expect(401);
    });

    it('rechaza con 401 si el código de recuperación es inválido', async () => {
      const { email } = await createUserWithMfaEnabled('recover.badcode');

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({
          email,
          password: TEST_PASSWORD,
          recoveryCode: 'ffff-0000-ffff-0000-ffff',
        })
        .expect(401);
    });

    it('rechaza con 401 si la cuenta no tiene MFA habilitado', async () => {
      const email = `recover.nomfa.${runId}@umbral.cl`;
      const passwordHash = await argon2.hash(TEST_PASSWORD);
      const user = await prisma.user.create({
        data: { email, passwordHash, name: 'Sin MFA' },
      });
      createdUserIds.push(user.id);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({ email, password: TEST_PASSWORD, recoveryCode: 'aaaa-bbbb' })
        .expect(401);
    });

    it('camino feliz: consume el código, desactiva MFA, y permite re-enrolar en el próximo login', async () => {
      const { email, id, recoveryCodes } =
        await createUserWithMfaEnabled('recover.happy');

      const recoverRes = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({
          email,
          password: TEST_PASSWORD,
          recoveryCode: recoveryCodes[0],
        })
        .expect(201);
      expect(typeof (recoverRes.body as Record<string, unknown>).message).toBe(
        'string',
      );
      expect(
        (recoverRes.body as Record<string, unknown>).accessToken as string,
      ).toBeUndefined();

      const user = await prisma.user.findUnique({ where: { id } });
      expect(user!.mfaEnabled).toBe(false);
      expect(user!.mfaSecret).toBeNull();

      // Sin MFA habilitado, el próximo login vuelve a exigir enrolamiento
      // forzado (mismo comportamiento que una cuenta que nunca tuvo MFA).
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(201);
      expect((loginRes.body as Record<string, unknown>).requiresMfaSetup).toBe(
        true,
      );
    });

    it('reusar el mismo código ya consumido rechaza con 401 (replay guard)', async () => {
      const { email, recoveryCodes } =
        await createUserWithMfaEnabled('recover.replay');

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({
          email,
          password: TEST_PASSWORD,
          recoveryCode: recoveryCodes[0],
        })
        .expect(201);

      // Segundo intento con el mismo código: MFA ya quedó deshabilitado por
      // el primer uso, así que este ahora falla en el chequeo de
      // mfaEnabled, no en el de "código ya usado" -- ambos caminos son 401.
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({
          email,
          password: TEST_PASSWORD,
          recoveryCode: recoveryCodes[0],
        })
        .expect(401);
    });

    it('volver a habilitar MFA invalida los recovery codes de la tanda anterior', async () => {
      const { email, recoveryCodes: firstBatch } =
        await createUserWithMfaEnabled('recover.superseded');

      // Deshabilita MFA con un código de la primera tanda.
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({ email, password: TEST_PASSWORD, recoveryCode: firstBatch[1] })
        .expect(201);

      // Re-enrola MFA: genera una tanda nueva de recovery codes.
      const bootstrapLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(201);
      const beginSetup = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/begin')
        .send({
          setupToken: (bootstrapLogin.body as Record<string, unknown>)
            .setupToken as string,
        })
        .expect(201);
      const totp = speakeasy.totp({
        secret: (beginSetup.body as Record<string, unknown>).secret as string,
        encoding: 'base32',
      });
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/setup/confirm')
        .send({
          setupToken: (bootstrapLogin.body as Record<string, unknown>)
            .setupToken as string,
          token: totp,
        })
        .expect(201);

      // Un código sin usar de la tanda VIEJA ya no sirve.
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/recover')
        .send({ email, password: TEST_PASSWORD, recoveryCode: firstBatch[2] })
        .expect(401);
    });
  });
});

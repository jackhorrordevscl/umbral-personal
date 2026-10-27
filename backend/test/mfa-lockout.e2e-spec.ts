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
 * Issue #487: límite de intentos del segundo factor por cuenta. Los
 * throttlers por IP se suben a propósito para probar que el bloqueo viene del
 * contador de la cuenta y no de la IP.
 */
describe('MFA lockout por cuenta (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const createdUserIds: string[] = [];

  async function createUserWithMfa(emailPrefix: string) {
    const email = `${emailPrefix}.${runId}@umbral.cl`;
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: 'MFA Lockout Test' },
    });
    createdUserIds.push(user.id);

    const bootstrap = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    const setupToken = (bootstrap.body as Record<string, unknown>)
      .setupToken as string;
    const begin = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken })
      .expect(201);
    const secret = (begin.body as Record<string, unknown>).secret as string;
    await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({
        setupToken,
        token: speakeasy.totp({ secret, encoding: 'base32' }),
      })
      .expect(201);

    return { email, id: user.id, secret };
  }

  async function loginForMfaToken(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    return (res.body as Record<string, unknown>).mfaToken as string;
  }

  // Un código válido y todavía no consumido: el del paso siguiente (la
  // verificación acepta una ventana de ±1 paso).
  function nextStepCode(secret: string): string {
    return speakeasy.totp({
      secret,
      encoding: 'base32',
      time: Math.floor(Date.now() / 1000) + 30,
    });
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

  it('tras 5 intentos libres arma el bloqueo y ni el código correcto pasa mientras dura', async () => {
    const { email, id, secret } = await createUserWithMfa('lockout.verify');
    const mfaToken = await loginForMfaToken(email);

    // 5 libres más el que arma el bloqueo: los seis se verifican y fallan.
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken, token: '000000' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken, token: '000000' })
      .expect(429);

    // Bloqueada: ni el código correcto sirve, y rechazar no suma intentos.
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(before.mfaLockedUntil).not.toBeNull();
    await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken, token: nextStepCode(secret) })
      .expect(429);
    const after = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(after.mfaFailedAttempts).toBe(before.mfaFailedAttempts);
    expect(after.mfaLockedUntil?.getTime()).toBe(
      before.mfaLockedUntil?.getTime(),
    );
  });

  it('vencido el bloqueo, el código correcto entra y limpia el contador', async () => {
    const { email, id, secret } = await createUserWithMfa('lockout.recover');
    const mfaToken = await loginForMfaToken(email);

    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken, token: '000000' });
    }
    // Se simula el paso del tiempo: el bloqueo vence, el contador sigue alto.
    await prisma.user.update({
      where: { id },
      data: { mfaLockedUntil: new Date(Date.now() - 1000) },
    });

    const ok = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken, token: nextStepCode(secret) })
      .expect(201);
    expect((ok.body as Record<string, unknown>).accessToken).toBeDefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.mfaFailedAttempts).toBe(0);
    expect(user.mfaFailedAt).toBeNull();
    expect(user.mfaLockedUntil).toBeNull();
  });

  it('el bloqueo es por cuenta: otra cuenta del mismo origen sigue entrando', async () => {
    const locked = await createUserWithMfa('lockout.victim');
    const other = await createUserWithMfa('lockout.other');
    const lockedToken = await loginForMfaToken(locked.email);
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ mfaToken: lockedToken, token: '000000' });
    }

    const otherToken = await loginForMfaToken(other.email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: otherToken, token: nextStepCode(other.secret) })
      .expect(201);
  });
});

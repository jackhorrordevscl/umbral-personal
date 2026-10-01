import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Issue #303 (T3): el email se normaliza (trim + minúsculas) en el DTO y en
 * el lookup, así que login resuelve a la MISMA cuenta sin importar cómo lo
 * escriba el usuario. Sin MFA configurado, login entrega un setupToken cuyo
 * `sub` identifica la cuenta resuelta.
 *
 * Mismo override de throttlers (límite alto, DI local a esta TestingModule)
 * que session-invalidation.e2e-spec.ts, para no compartir presupuesto con
 * las demás suites e2e.
 */
describe('Login con email en distinta capitalización (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const runId = Date.now();
  const PASSWORD = 'TestPass123!';
  const email = `login.case.${runId}@umbral.cl`;
  let userId: string;

  async function loginSub(emailInput: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: emailInput, password: PASSWORD })
      .expect(201);
    const { setupToken } = res.body as { setupToken: string };
    expect(typeof setupToken).toBe('string');
    const payload = jwtService.decode<{ sub: string }>(setupToken);
    return payload.sub;
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

    const passwordHash = await argon2.hash(PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: 'Login Case Test' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Nunca hard-delete: AuditLog usa onDelete: Restrict sobre userId.
    await prisma.user.updateMany({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
    await app.close();
  });

  it('email en minúsculas resuelve a la cuenta', async () => {
    expect(await loginSub(email)).toBe(userId);
  });

  it('email en mayúsculas resuelve a la misma cuenta', async () => {
    expect(await loginSub(email.toUpperCase())).toBe(userId);
  });

  it('email con capitalización mixta y espacios resuelve a la misma cuenta', async () => {
    const mixed = `  ${email[0].toUpperCase()}${email.slice(1)}  `;
    expect(await loginSub(mixed)).toBe(userId);
  });
});

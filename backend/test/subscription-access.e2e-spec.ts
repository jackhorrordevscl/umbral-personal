import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashInvitationCode } from '../src/modules/auth/invitation-code.util';

/**
 * Issue #611 (PR 3): con SUBSCRIPTIONS_ENFORCED encendido, una cuenta sin
 * suscripción vigente queda en solo lectura (402 en escrituras), su agenda
 * pública deja de estar disponible y el registro es abierto con código
 * promocional opcional.
 */
describe('Subscription access (e2e, SUBSCRIPTIONS_ENFORCED=true)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  const ORIGINAL_ENV = {
    SUBSCRIPTIONS_ENFORCED: process.env.SUBSCRIPTIONS_ENFORCED,
    PUBLIC_SCHEDULING_ENABLED: process.env.PUBLIC_SCHEDULING_ENABLED,
  };
  const emails: string[] = [];
  const promoIds: string[] = [];
  const userIds: string[] = [];

  let readOnly: { id: string; token: string };
  let active: { id: string; token: string };
  let exempt: { id: string; token: string };

  async function createProfessionalAndLogin(email: string) {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(TEST_PASSWORD),
        name: 'Access Therapist',
      },
    });
    userIds.push(user.id);
    emails.push(email);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    const setupToken = (login.body as Record<string, unknown>)
      .setupToken as string;
    const begin = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken })
      .expect(201);
    const totp = speakeasy.totp({
      secret: (begin.body as Record<string, unknown>).secret as string,
      encoding: 'base32',
    });
    const confirm = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken, token: totp })
      .expect(201);
    return {
      id: user.id,
      token: (confirm.body as Record<string, unknown>).accessToken as string,
    };
  }

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const availabilityUrl = (therapistId: string) => {
    const from = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 6 * 86_400_000).toISOString();
    return `/api/v1/public/therapists/${therapistId}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  };

  beforeAll(async () => {
    process.env.SUBSCRIPTIONS_ENFORCED = 'true';
    process.env.PUBLIC_SCHEDULING_ENABLED = 'true';

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

    readOnly = await createProfessionalAndLogin(`sub.ro.${runId}@umbral.cl`);
    active = await createProfessionalAndLogin(`sub.active.${runId}@umbral.cl`);
    exempt = await createProfessionalAndLogin(`sub.exempt.${runId}@umbral.cl`);
    await prisma.subscription.create({
      data: {
        userId: active.id,
        currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
        priceClp: 6990,
        priceStartedAt: new Date(),
      },
    });
    await prisma.subscriptionGrant.create({
      data: { email: `sub.exempt.${runId}@umbral.cl`, expiresAt: null },
    });
  }, 120000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.promoRedemption.deleteMany({
      where: { user: { email: { startsWith: `sub.open.${runId}` } } },
    });
    await prisma.promoCode.deleteMany({ where: { id: { in: promoIds } } });
    await prisma.subscription.deleteMany({
      where: {
        user: {
          email: { in: emails.concat(`sub.open.${runId}.promo@umbral.cl`) },
        },
      },
    });
    await prisma.subscriptionGrant.deleteMany({
      where: { email: { in: emails } },
    });
    await app.close();
  });

  describe('solo lectura', () => {
    it('las lecturas siguen funcionando', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set(as(readOnly.token))
        .expect(200);
    });

    it('una escritura bloqueada responde 402 con el código estable, antes de validar el cuerpo', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(as(readOnly.token))
        .send({})
        .expect(402);
      expect((res.body as { code: string }).code).toBe('SUBSCRIPTION_REQUIRED');
    });

    it('una escritura de la lista de permitidas pasa', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notifications/read-all')
        .set(as(readOnly.token))
        .expect(200);
    });

    it('una cuenta con período vigente puede escribir (llega a la validación del cuerpo)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(as(active.token))
        .send({})
        .expect(400);
    });

    it('una cuenta exenta por concesión puede escribir', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(as(exempt.token))
        .send({})
        .expect(400);
    });

    it('al pagar (período vigente) la cuenta deja de estar bloqueada', async () => {
      await prisma.subscription.create({
        data: {
          userId: readOnly.id,
          currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000),
          priceClp: 6990,
          priceStartedAt: new Date(),
        },
      });
      try {
        await request(app.getHttpServer())
          .post('/api/v1/patients')
          .set(as(readOnly.token))
          .send({})
          .expect(400);
      } finally {
        await prisma.subscription.deleteMany({
          where: { userId: readOnly.id },
        });
      }
    });

    it('GET /billing/status informa el estado de la cuenta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/status')
        .set(as(readOnly.token))
        .expect(200);
      expect(res.body).toMatchObject({
        enforced: true,
        state: 'READ_ONLY',
        priceClp: 6990,
      });
    });
  });

  describe('agenda pública', () => {
    it('la de una cuenta en solo lectura no está disponible (503)', async () => {
      await request(app.getHttpServer())
        .get(availabilityUrl(readOnly.id))
        .expect(503);
    });

    it('la de una cuenta con suscripción vigente sigue disponible', async () => {
      await request(app.getHttpServer())
        .get(availabilityUrl(active.id))
        .expect(200);
    });
  });

  describe('registro abierto', () => {
    const signup = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/api/v1/auth/signup').send(body);

    it('crea la cuenta sin código de invitación', async () => {
      const email = `sub.open.${runId}.plain@umbral.cl`;
      emails.push(email);
      await signup({
        email,
        password: 'TestPass123!',
        name: 'Abierta Plana',
      }).expect(201);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      userIds.push(user.id);
      expect(user.emailVerified).toBe(false);
      expect(
        await prisma.subscription.count({ where: { userId: user.id } }),
      ).toBe(0);
    }, 30000);

    it('con un código promocional válido otorga ~30 días y cuenta el canje', async () => {
      const code = `FLYER-${runId}`;
      const promo = await prisma.promoCode.create({
        data: {
          codeHash: hashInvitationCode(code),
          channel: 'e2e',
          trialDays: 30,
          maxRedemptions: 30,
          expiresAt: new Date(Date.now() + 60 * 86_400_000),
        },
      });
      promoIds.push(promo.id);
      const email = `sub.open.${runId}.promo@umbral.cl`;
      emails.push(email);

      await signup({
        email,
        password: 'TestPass123!',
        name: 'Abierta Promo',
        promoCode: code,
      }).expect(201);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      userIds.push(user.id);
      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { userId: user.id },
      });
      expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(
        Date.now() + 29 * 86_400_000,
      );
      expect(
        (await prisma.promoCode.findUniqueOrThrow({ where: { id: promo.id } }))
          .redemptionCount,
      ).toBe(1);
    }, 30000);

    it('un código promocional inválido responde 400 sin crear la cuenta', async () => {
      const email = `sub.open.${runId}.bad@umbral.cl`;
      await signup({
        email,
        password: 'TestPass123!',
        name: 'Abierta Mala',
        promoCode: 'NO-EXISTE',
      }).expect(400);

      expect(await prisma.user.count({ where: { email } })).toBe(0);
    }, 30000);

    it('un código inválido responde igual para un email que ya existe (no revela cuentas)', async () => {
      const existing = await signup({
        email: `sub.ro.${runId}@umbral.cl`,
        password: 'TestPass123!',
        name: 'Ya Existe',
        promoCode: 'NO-EXISTE',
      });
      expect(existing.status).toBe(400);
    }, 30000);
  });
});

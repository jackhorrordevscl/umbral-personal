import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { main as grantSubscription } from '../scripts/grant-subscription';

/**
 * Issue #631: cobertura e2e de las cuentas exentas cargadas con el script
 * `scripts/grant-subscription.ts`. Ejecuta `main()` contra la base real (el
 * upsert, la repetición que actualiza la vigencia y la normalización del
 * email) y comprueba el efecto sobre cuentas que se registran por la API.
 *
 * Decisión de #611 que esta suite deja escrita: la concesión se aplica "al
 * verificar el email, no al crear la cuenta". `getAccess` no mira
 * `emailVerified`; la protección contra registrarse con un email ajeno es
 * que el login exige el email verificado, así que quien se registra con un
 * email que no controla nunca obtiene una sesión.
 */
describe('Concesión de suscripción con el script (e2e, SUBSCRIPTIONS_ENFORCED=true)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let logSpy: jest.SpyInstance;

  const runId = Date.now();
  const PASSWORD = 'TestPass123!';
  const ORIGINAL_ENFORCED = process.env.SUBSCRIPTIONS_ENFORCED;
  const emails: string[] = [];

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());

  // Registro abierto + verificación del email (el token se firma igual que
  // AuthService.signup: el controller no lo expone, solo viaja por correo).
  async function signupUnverified(email: string): Promise<string> {
    emails.push(email);
    await http()
      .post('/api/v1/auth/signup')
      .send({ email, name: 'Concesión E2E' })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return user.id;
  }

  async function verifyEmail(userId: string): Promise<void> {
    const token = app
      .get(JwtService)
      .sign({ sub: userId, purpose: 'email-verify' }, { expiresIn: '24h' });
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token, password: PASSWORD })
      .expect(201);
  }

  async function loginWithMfa(email: string): Promise<string> {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    const setupToken = (login.body as { setupToken: string }).setupToken;
    const begin = await http()
      .post('/api/v1/auth/mfa/setup/begin')
      .send({ setupToken })
      .expect(201);
    const totp = speakeasy.totp({
      secret: (begin.body as { secret: string }).secret,
      encoding: 'base32',
    });
    const confirm = await http()
      .post('/api/v1/auth/mfa/setup/confirm')
      .send({ setupToken, token: totp })
      .expect(201);
    return (confirm.body as { accessToken: string }).accessToken;
  }

  const billingState = async (token: string) =>
    (await http().get('/api/v1/billing/status').set(as(token)).expect(200))
      .body as { state: string; periodEnd: string | null };

  beforeAll(async () => {
    process.env.SUBSCRIPTIONS_ENFORCED = 'true';
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
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  }, 120000);

  afterAll(async () => {
    logSpy.mockRestore();
    if (ORIGINAL_ENFORCED === undefined) {
      delete process.env.SUBSCRIPTIONS_ENFORCED;
    } else {
      process.env.SUBSCRIPTIONS_ENFORCED = ORIGINAL_ENFORCED;
    }
    await prisma.subscription.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.subscriptionGrant.deleteMany({
      where: { email: { in: emails } },
    });
    await prisma.user.updateMany({
      where: { email: { in: emails } },
      data: { deletedAt: new Date() },
    });
    await app.close();
  });

  describe('main() contra la base real', () => {
    it('crea la concesión con el email normalizado, la repite sin duplicar y actualiza la vigencia', async () => {
      const email = `grant.main.${runId}@umbral.cl`;
      emails.push(email);

      await grantSubscription([`  ${email.toUpperCase()}  `]);
      const created = await prisma.subscriptionGrant.findMany({
        where: { email },
      });
      expect(created).toHaveLength(1);
      expect(created[0].expiresAt).toBeNull();

      await grantSubscription([email, '--until', '2099-12-31']);
      const updated = await prisma.subscriptionGrant.findMany({
        where: { email },
      });
      expect(updated).toHaveLength(1);
      expect(updated[0].id).toBe(created[0].id);
      expect(updated[0].expiresAt?.toISOString()).toBe(
        '2099-12-31T23:59:59.999Z',
      );

      await grantSubscription([email]);
      const permanent = await prisma.subscriptionGrant.findUniqueOrThrow({
        where: { email },
      });
      expect(permanent.expiresAt).toBeNull();
    }, 30000);

    it('un argumento inválido falla sin tocar la base', async () => {
      const before = await prisma.subscriptionGrant.count();
      await expect(grantSubscription(['no-es-un-email'])).rejects.toThrow(
        'Uso: grant-subscription.ts',
      );
      await expect(
        grantSubscription([`x.${runId}@umbral.cl`, '--until', '31-12-2099']),
      ).rejects.toThrow('--until requiere una fecha YYYY-MM-DD');
      expect(await prisma.subscriptionGrant.count()).toBe(before);
    }, 30000);
  });

  describe('concesión cargada antes del registro', () => {
    it('la cuenta no puede iniciar sesión sin verificar el email y queda exenta al verificarlo', async () => {
      const email = `grant.pre.${runId}@umbral.cl`;
      await grantSubscription([email.toUpperCase()]);

      const userId = await signupUnverified(email);

      // Sin verificar no hay sesión: el login lo rechaza, así que un email
      // ajeno registrado por un tercero nunca obtiene la exención.
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);

      await verifyEmail(userId);
      const token = await loginWithMfa(email);

      expect(await billingState(token)).toMatchObject({
        state: 'EXEMPT',
        periodEnd: null,
      });
      // Exenta: la escritura llega a la validación del cuerpo (400), no al 402.
      await http().post('/api/v1/patients').set(as(token)).send({}).expect(400);
    }, 60000);
  });

  describe('concesión temporal vencida', () => {
    it('sin período pagado la cuenta queda en solo lectura (402 en escrituras)', async () => {
      const email = `grant.expired.ro.${runId}@umbral.cl`;
      await grantSubscription([email, '--until', '2020-01-01']);
      const userId = await signupUnverified(email);
      await verifyEmail(userId);
      const token = await loginWithMfa(email);

      expect((await billingState(token)).state).toBe('READ_ONLY');
      const res = await http()
        .post('/api/v1/patients')
        .set(as(token))
        .send({})
        .expect(402);
      expect((res.body as { code: string }).code).toBe('SUBSCRIPTION_REQUIRED');
    }, 60000);

    it('con un período pagado recién vencido cae en el período de gracia y aún escribe', async () => {
      const email = `grant.expired.grace.${runId}@umbral.cl`;
      await grantSubscription([email, '--until', '2020-01-01']);
      const userId = await signupUnverified(email);
      await verifyEmail(userId);
      await prisma.subscription.create({
        data: {
          userId,
          currentPeriodEnd: new Date(Date.now() - 2 * 86_400_000),
          priceClp: 6990,
          priceStartedAt: new Date(Date.now() - 40 * 86_400_000),
        },
      });
      const token = await loginWithMfa(email);

      expect((await billingState(token)).state).toBe('GRACE');
      await http().post('/api/v1/patients').set(as(token)).send({}).expect(400);
    }, 60000);

    it('renovar la concesión con el script la devuelve a exenta', async () => {
      const email = `grant.expired.renew.${runId}@umbral.cl`;
      await grantSubscription([email, '--until', '2020-01-01']);
      const userId = await signupUnverified(email);
      await verifyEmail(userId);
      const token = await loginWithMfa(email);
      expect((await billingState(token)).state).toBe('READ_ONLY');

      await grantSubscription([email]);
      expect((await billingState(token)).state).toBe('EXEMPT');
    }, 60000);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FlowPaymentGatewayClient } from '../src/modules/payments/flow-gateway.client';

/**
 * Issue #611 (PR 2): cobro de la suscripción por HTTP real. checkout exige
 * sesión; confirm y return son públicos. El acceso solo se concede cuando
 * getStatus (stubeado, sin red) confirma el pago por el monto cobrado.
 */
describe('Billing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let flow: FlowPaymentGatewayClient;

  const runId = Date.now();
  const TEST_PASSWORD = 'TestPass123!';
  let accessToken: string;
  let userId: string;
  let tokenSeq = 0;

  async function createProfessionalAndLogin(email: string) {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(TEST_PASSWORD),
        name: 'Billing Therapist',
      },
    });
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

  const checkout = async () => {
    const flowToken = `e2e-billing-${runId}-${++tokenSeq}`;
    jest.spyOn(flow, 'createOrder').mockResolvedValueOnce({
      token: flowToken,
      paymentUrl: `https://flow.test/pay?token=${flowToken}`,
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    return { flowToken, body: res.body as { paymentUrl: string } };
  };

  const subscriptionEnd = async () =>
    (await prisma.subscription.findUnique({ where: { userId } }))
      ?.currentPeriodEnd ?? null;

  beforeAll(async () => {
    process.env.SUBSCRIPTION_FLOW_API_KEY = 'e2e-platform-key';
    process.env.SUBSCRIPTION_FLOW_SECRET_KEY = 'e2e-platform-secret';

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
    flow = app.get(FlowPaymentGatewayClient);
    const user = await createProfessionalAndLogin(`billing.${runId}@umbral.cl`);
    userId = user.id;
    accessToken = user.token;
  }, 90000);

  afterAll(async () => {
    jest.restoreAllMocks();
    delete process.env.SUBSCRIPTION_FLOW_API_KEY;
    delete process.env.SUBSCRIPTION_FLOW_SECRET_KEY;
    await prisma.subscriptionPayment.deleteMany({
      where: { subscription: { userId } },
    });
    await prisma.subscription.deleteMany({ where: { userId } });
    await app.close();
  });

  it('POST /billing/checkout exige sesión', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/billing/checkout')
      .expect(401);
  });

  it('checkout devuelve la URL de pago y crea el pago PENDING sin conceder acceso', async () => {
    const { flowToken, body } = await checkout();

    expect(body.paymentUrl).toBe(`https://flow.test/pay?token=${flowToken}`);
    const payment = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { flowToken },
    });
    expect(payment.status).toBe('PENDING');
    expect(payment.amountClp).toBe(6990);
    expect(await subscriptionEnd()).toBeNull();
  }, 30000);

  it('confirm rechaza con 400 uniforme: token desconocido y campos extra', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/billing/confirm')
      .send({ token: `desconocido-${runId}` })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/billing/confirm')
      .send({ token: 'x', extra: 'no permitido' })
      .expect(400);
    expect((unknown.body as { message: string }).message).toBe(
      'Confirmación de pago rechazada.',
    );
  });

  it('confirm público: Flow reporta PAID por el monto cobrado, concede acceso y un reintento no suma', async () => {
    const { flowToken } = await checkout();
    const status = jest.spyOn(flow, 'getOrderStatus').mockResolvedValue({
      status: 'PAID',
      gatewayPaymentId: String(8_100_000 + tokenSeq),
      amount: 6990,
    });

    await request(app.getHttpServer())
      .post('/api/v1/billing/confirm')
      .send({ token: flowToken })
      .expect(200);
    const first = await subscriptionEnd();
    expect(first).not.toBeNull();
    expect(first!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    await request(app.getHttpServer())
      .post('/api/v1/billing/confirm')
      .send({ token: flowToken })
      .expect(200);
    expect(await subscriptionEnd()).toEqual(first);
    status.mockRestore();
  }, 30000);

  it('confirm con Flow caído responde 400 y no concede acceso', async () => {
    const before = await subscriptionEnd();
    const { flowToken } = await checkout();
    jest.spyOn(flow, 'getOrderStatus').mockRejectedValueOnce(new Error('Flow'));

    await request(app.getHttpServer())
      .post('/api/v1/billing/confirm')
      .send({ token: flowToken })
      .expect(400);
    expect(await subscriptionEnd()).toEqual(before);
  }, 30000);

  it('return redirige 302 a la pantalla del frontend por GET y por POST', async () => {
    const get = await request(app.getHttpServer())
      .get('/api/v1/billing/return')
      .expect(302);
    const post = await request(app.getHttpServer())
      .post('/api/v1/billing/return')
      .type('form')
      .send({ token: 'cualquiera' })
      .expect(302);
    expect(get.headers.location).toMatch(/\/suscripcion\/retorno$/);
    expect(post.headers.location).toBe(get.headers.location);
  });
});

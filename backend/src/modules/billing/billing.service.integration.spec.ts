import * as argon2 from 'argon2';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowPaymentGatewayClient } from '../payments/flow-gateway.client';
import { GatewayOrderStatus } from '../payments/payment-gateway.client';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BillingService } from './billing.service';

const HOUR_MS = 60 * 60 * 1000;

// Issue #611 (PR 2): flujo de cobro completo contra Postgres real, con Flow
// simulado. Prueba que el acceso solo se concede cuando getStatus confirma el
// pago por el monto cobrado, y que repetir la confirmación no suma de nuevo.
describe('BillingService (integration, real Prisma, Flow simulado)', () => {
  let prisma: PrismaService;
  let subscriptions: SubscriptionsService;
  let flow: {
    createOrder: jest.Mock;
    getOrderStatus: jest.Mock;
  };
  let env: Record<string, string | undefined>;
  let service: BillingService;
  const runId = Date.now();
  const userIds: string[] = [];
  let tokenSeq = 0;

  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;

  const createUser = async (tag: string) => {
    const user = await prisma.user.create({
      data: {
        email: `bill611-${tag}-${runId}@example.com`,
        passwordHash: await argon2.hash('TestPass123!'),
        name: 'Dra. Cobro',
      },
    });
    userIds.push(user.id);
    return user.id;
  };

  const flowStatus = (
    status: GatewayOrderStatus,
    amount: number | undefined,
    flowOrder = 7_000_000 + ++tokenSeq,
  ) => ({ status, gatewayPaymentId: String(flowOrder), amount });

  const checkout = async (tag: string) => {
    const userId = await createUser(tag);
    const token = `tok-${tag}-${runId}`;
    flow.createOrder.mockResolvedValueOnce({
      token,
      paymentUrl: `https://flow.test/pay?token=${token}`,
    });
    const result = await service.createCheckout(userId);
    return { userId, token, result };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  }, 30000);

  beforeEach(() => {
    env = {
      SUBSCRIPTION_FLOW_API_KEY: 'platform-key',
      SUBSCRIPTION_FLOW_SECRET_KEY: 'platform-secret',
      BACKEND_PUBLIC_URL: 'https://api.test',
      FRONTEND_URL: 'https://app.test',
    };
    flow = { createOrder: jest.fn(), getOrderStatus: jest.fn() };
    subscriptions = new SubscriptionsService(prisma, config);
    service = new BillingService(
      prisma,
      config,
      flow as unknown as FlowPaymentGatewayClient,
      subscriptions,
    );
  });

  afterAll(async () => {
    await prisma.subscriptionPayment.deleteMany({
      where: { subscription: { userId: { in: userIds } } },
    });
    await prisma.subscription.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('checkout: crea el pago PENDING con el precio congelado y devuelve la URL de Flow', async () => {
    const { userId, token, result } = await checkout('co');

    expect(result.paymentUrl).toBe(`https://flow.test/pay?token=${token}`);
    const [credentials, input] = flow.createOrder.mock.calls[0] as [
      { apiKey: string },
      Record<string, unknown>,
    ];
    expect(credentials.apiKey).toBe('platform-key');
    expect(input).toMatchObject({
      amount: 6990,
      currency: 'CLP',
      payerEmail: `bill611-co-${runId}@example.com`,
      confirmUrl: 'https://api.test/api/v1/billing/confirm',
      returnUrl: 'https://api.test/api/v1/billing/return',
    });
    const payment = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { flowToken: token },
    });
    expect(payment.status).toBe('PENDING');
    expect(payment.amountClp).toBe(6990);
    // Crear la orden NO concede acceso.
    expect((await subscriptions.getAccess(userId)).state).toBe('READ_ONLY');
  }, 30000);

  it('checkout sin credenciales de la plataforma responde 503 y no crea nada', async () => {
    env.SUBSCRIPTION_FLOW_API_KEY = undefined;
    const userId = await createUser('nocreds');

    await expect(service.createCheckout(userId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(flow.createOrder).not.toHaveBeenCalled();
    expect(
      await prisma.subscriptionPayment.count({
        where: { subscription: { userId } },
      }),
    ).toBe(0);
  }, 30000);

  it('si Flow falla al crear la orden, el pago queda FAILED y responde 503', async () => {
    const userId = await createUser('flowdown');
    flow.createOrder.mockRejectedValueOnce(new Error('Flow caído'));

    await expect(service.createCheckout(userId)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const payments = await prisma.subscriptionPayment.findMany({
      where: { subscription: { userId } },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('FAILED');
    expect(payments[0].flowToken).toBeNull();
  }, 30000);

  it('confirm: pagado por el monto cobrado concede 30 días y queda PAID', async () => {
    const { userId, token } = await checkout('paid');
    flow.getOrderStatus.mockResolvedValue(flowStatus('PAID', 6990));

    expect(await service.confirmByToken(token)).toBe('applied');

    const payment = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { flowToken: token },
    });
    expect(payment.status).toBe('PAID');
    expect(payment.flowOrder).not.toBeNull();
    const access = await subscriptions.getAccess(userId);
    expect(access.state).toBe('ACTIVE');
  }, 30000);

  it('confirm repetido (webhook duplicado) no suma otra vez', async () => {
    const { userId, token } = await checkout('dup');
    flow.getOrderStatus.mockResolvedValue(flowStatus('PAID', 6990, 7_999_001));
    await service.confirmByToken(token);
    const first = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });

    expect(await service.confirmByToken(token)).toBe('already_applied');

    const second = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });
    expect(second.currentPeriodEnd).toEqual(first.currentPeriodEnd);
  }, 30000);

  it('confirm con monto distinto del cobrado no concede acceso', async () => {
    const { userId, token } = await checkout('amount');
    flow.getOrderStatus.mockResolvedValue(flowStatus('PAID', 100));

    expect(await service.confirmByToken(token)).toBe('anomaly');

    expect((await subscriptions.getAccess(userId)).state).toBe('READ_ONLY');
    const payment = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { flowToken: token },
    });
    expect(payment.status).toBe('PENDING');
  }, 30000);

  it('confirm con orden aún pendiente no cambia nada; rechazada la marca FAILED', async () => {
    const pending = await checkout('pend');
    flow.getOrderStatus.mockResolvedValueOnce(flowStatus('PENDING', undefined));
    expect(await service.confirmByToken(pending.token)).toBe('pending');

    const rejected = await checkout('rej');
    flow.getOrderStatus.mockResolvedValueOnce(flowStatus('REJECTED', 6990));
    expect(await service.confirmByToken(rejected.token)).toBe('failed');

    const row = (token: string) =>
      prisma.subscriptionPayment.findUniqueOrThrow({
        where: { flowToken: token },
      });
    expect((await row(pending.token)).status).toBe('PENDING');
    expect((await row(rejected.token)).status).toBe('FAILED');
  }, 30000);

  it('confirm con un token desconocido devuelve unknown sin consultar a Flow', async () => {
    expect(await service.confirmByToken(`nope-${runId}`)).toBe('unknown');
    expect(flow.getOrderStatus).not.toHaveBeenCalled();
  }, 30000);

  it('confirm propaga el error si Flow no puede consultarse (no concede acceso)', async () => {
    const { userId, token } = await checkout('flowerr');
    flow.getOrderStatus.mockRejectedValueOnce(new Error('timeout'));

    await expect(service.confirmByToken(token)).rejects.toThrow('timeout');
    expect((await subscriptions.getAccess(userId)).state).toBe('READ_ONLY');
  }, 30000);

  it('tope de checkouts abiertos: el sexto de la misma cuenta responde 429 y no crea nada', async () => {
    const userId = await createUser('cap');
    for (let i = 0; i < 5; i++) {
      flow.createOrder.mockResolvedValueOnce({
        token: `tok-cap-${i}-${runId}`,
        paymentUrl: 'https://flow.test/pay',
      });
      await service.createCheckout(userId);
    }

    const sixth = await service.createCheckout(userId).catch((e: unknown) => e);

    expect(sixth).toBeInstanceOf(HttpException);
    expect((sixth as HttpException).getStatus()).toBe(429);
    expect(flow.createOrder).toHaveBeenCalledTimes(5);
    expect(
      await prisma.subscriptionPayment.count({
        where: { subscription: { userId } },
      }),
    ).toBe(5);
  }, 30000);

  it('el tope no cuenta los pagos fallidos (Flow caído al crear la orden)', async () => {
    const userId = await createUser('cap-failed');
    for (let i = 0; i < 6; i++) {
      flow.createOrder.mockRejectedValueOnce(new Error('Flow caído'));
      await service.createCheckout(userId).catch(() => undefined);
    }
    flow.createOrder.mockResolvedValueOnce({
      token: `tok-capfail-ok-${runId}`,
      paymentUrl: 'https://flow.test/pay',
    });

    await expect(service.createCheckout(userId)).resolves.toBeDefined();
  }, 30000);

  it('el barrido consulta primero los pagos más recientes', async () => {
    const older = await checkout('order-older');
    const newer = await checkout('order-newer');
    await prisma.subscriptionPayment.update({
      where: { flowToken: older.token },
      data: { createdAt: new Date(Date.now() - 3 * HOUR_MS) },
    });
    await prisma.subscriptionPayment.update({
      where: { flowToken: newer.token },
      data: { createdAt: new Date(Date.now() - 2 * HOUR_MS) },
    });
    flow.getOrderStatus.mockResolvedValue(flowStatus('PENDING', undefined));

    await service.sweep();

    const queried = flow.getOrderStatus.mock.calls.map(
      (c: unknown[]) => c[1] as string,
    );
    expect(queried.indexOf(newer.token)).toBeGreaterThanOrEqual(0);
    expect(queried.indexOf(newer.token)).toBeLessThan(
      queried.indexOf(older.token),
    );
  }, 30000);

  it('el barrido recupera un pago cuyo webhook se perdió, y deja los recientes', async () => {
    const lost = await checkout('sweep-lost');
    const fresh = await checkout('sweep-fresh');
    // `lost` se creó hace 1 h; `fresh` ahora mismo (menos de 15 min).
    await prisma.subscriptionPayment.update({
      where: { flowToken: lost.token },
      data: { createdAt: new Date(Date.now() - HOUR_MS) },
    });
    flow.getOrderStatus.mockImplementation((_c: unknown, token: string) =>
      Promise.resolve(
        token === lost.token
          ? flowStatus('PAID', 6990)
          : flowStatus('PENDING', undefined),
      ),
    );

    await service.sweep();

    expect((await subscriptions.getAccess(lost.userId)).state).toBe('ACTIVE');
    expect((await subscriptions.getAccess(fresh.userId)).state).toBe(
      'READ_ONLY',
    );
    // Solo el candidato maduro y de la ventana se consultó. El barrido es
    // global: pagos PENDING de otras corridas también pueden aparecer.
    const queried = flow.getOrderStatus.mock.calls.map(
      (c: unknown[]) => c[1] as string,
    );
    expect(queried).toContain(lost.token);
    expect(queried).not.toContain(fresh.token);
  }, 30000);
});

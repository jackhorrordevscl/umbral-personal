import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { hashInvitationCode } from '../auth/invitation-code.util';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// Issue #611: lo que los mocks no pueden demostrar -- el tope de canjes, la
// idempotencia por pago y el bloqueo de la suscripción bajo concurrencia real
// contra Postgres.
describe('SubscriptionsService (integration, real Prisma)', () => {
  let prisma: PrismaService;
  let service: SubscriptionsService;
  const runId = Date.now();
  const userIds: string[] = [];
  const promoIds: string[] = [];
  const now = new Date('2026-11-10T12:00:00Z');
  const days = (d: number) => new Date(now.getTime() + d * DAY_MS);

  const createUser = async (tag: string) => {
    const user = await prisma.user.create({
      data: {
        email: `sub611-${tag}-${runId}@example.com`,
        passwordHash: await argon2.hash('TestPass123!'),
        name: 'Dra. Suscripción',
      },
    });
    userIds.push(user.id);
    return user.id;
  };

  const createPromo = async (
    code: string,
    overrides: { maxRedemptions?: number; expiresAt?: Date } = {},
  ) => {
    const promo = await prisma.promoCode.create({
      data: {
        codeHash: hashInvitationCode(`${code}-${runId}`),
        channel: 'test',
        trialDays: 30,
        maxRedemptions: overrides.maxRedemptions ?? 30,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * DAY_MS),
      },
    });
    promoIds.push(promo.id);
    return { id: promo.id, code: `${code}-${runId}` };
  };

  const redeem = (userId: string, code: string) =>
    prisma.$transaction((tx) =>
      service.redeemPromoCode(tx, userId, code, new Date()),
    );

  const createSubscriptionWithPayments = async (tag: string, count: number) => {
    const userId = await createUser(tag);
    const subscription = await prisma.subscription.create({
      data: { userId, priceClp: 6990, priceStartedAt: now },
    });
    const orders: string[] = [];
    for (let i = 0; i < count; i++) {
      const commerceOrder = `sub611-${tag}-${i}-${runId}`;
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          commerceOrder,
          amountClp: 6990,
        },
      });
      orders.push(commerceOrder);
    }
    return { userId, subscriptionId: subscription.id, orders };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new SubscriptionsService(prisma, {
      get: () => undefined,
    } as unknown as ConfigService);
  }, 30000);

  afterAll(async () => {
    await prisma.promoRedemption.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.promoCode.deleteMany({ where: { id: { in: promoIds } } });
    await prisma.subscriptionPayment.deleteMany({
      where: { subscription: { userId: { in: userIds } } },
    });
    await prisma.subscription.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('redeemPromoCode', () => {
    it('con el tope en 3, de 6 canjes simultáneos pasan exactamente 3', async () => {
      const promo = await createPromo('cap', { maxRedemptions: 3 });
      const users = await Promise.all(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((t) => createUser(`cap-${t}`)),
      );

      const results = await Promise.allSettled(
        users.map((id) => redeem(id, promo.code)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
      const row = await prisma.promoCode.findUniqueOrThrow({
        where: { id: promo.id },
      });
      expect(row.redemptionCount).toBe(3);
      expect(
        await prisma.promoRedemption.count({
          where: { promoCodeId: promo.id },
        }),
      ).toBe(3);
    }, 30000);

    it('canjea: crea la suscripción con el precio y 30 días de prueba', async () => {
      const promo = await createPromo('ok');
      const userId = await createUser('ok');
      const before = Date.now();

      const end = await redeem(userId, promo.code);

      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { userId },
      });
      expect(sub.priceClp).toBe(6990);
      expect(sub.currentPeriodEnd?.getTime()).toBe(end.getTime());
      expect(end.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
      expect((await service.getAccess(userId)).state).toBe('ACTIVE');
    }, 30000);

    it('el segundo canje de la misma cuenta se rechaza y no gasta un cupo', async () => {
      const promo = await createPromo('twice');
      const userId = await createUser('twice');
      await redeem(userId, promo.code);

      await expect(redeem(userId, promo.code)).rejects.toBeDefined();

      const row = await prisma.promoCode.findUniqueOrThrow({
        where: { id: promo.id },
      });
      expect(row.redemptionCount).toBe(1);
    }, 30000);

    it('un código vencido se rechaza sin tocar el contador', async () => {
      const promo = await createPromo('expired', {
        expiresAt: new Date(Date.now() - DAY_MS),
      });
      const userId = await createUser('expired');

      await expect(redeem(userId, promo.code)).rejects.toThrow(
        'Código promocional inválido o vencido',
      );
      const row = await prisma.promoCode.findUniqueOrThrow({
        where: { id: promo.id },
      });
      expect(row.redemptionCount).toBe(0);
    }, 30000);
  });

  describe('applyPaidPeriod', () => {
    it('dos pagos distintos simultáneos suman 60 días (el bloqueo evita que se pisen)', async () => {
      const { subscriptionId, orders } = await createSubscriptionWithPayments(
        'two',
        2,
      );

      const results = await Promise.all([
        service.applyPaidPeriod(orders[0], 1000001, now),
        service.applyPaidPeriod(orders[1], 1000002, now),
      ]);

      expect(results.every((r) => r !== null)).toBe(true);
      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.currentPeriodEnd).toEqual(days(60));
    }, 30000);

    it('el mismo pago aplicado dos veces a la vez suma 30 días una sola vez', async () => {
      const { subscriptionId, orders } = await createSubscriptionWithPayments(
        'dup',
        1,
      );

      const results = await Promise.all([
        service.applyPaidPeriod(orders[0], 2000001, now),
        service.applyPaidPeriod(orders[0], 2000001, now),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.currentPeriodEnd).toEqual(days(30));
    }, 30000);

    it('un webhook repetido después de aplicado no vuelve a sumar', async () => {
      const { subscriptionId, orders } = await createSubscriptionWithPayments(
        'repeat',
        1,
      );
      await service.applyPaidPeriod(orders[0], 3000001, now);

      expect(await service.applyPaidPeriod(orders[0], 3000001, now)).toBeNull();

      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.currentPeriodEnd).toEqual(days(30));
    }, 30000);

    it('flowOrder es único: otro pago no puede reclamar el mismo flowOrder', async () => {
      const { orders } = await createSubscriptionWithPayments('uniq', 2);
      await service.applyPaidPeriod(orders[0], 4000001, now);

      await expect(
        service.applyPaidPeriod(orders[1], 4000001, now),
      ).rejects.toBeDefined();
    }, 30000);
  });
});

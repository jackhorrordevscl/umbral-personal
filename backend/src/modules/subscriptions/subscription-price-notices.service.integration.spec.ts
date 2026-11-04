import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionPriceNoticesService } from './subscription-price-notices.service';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-10-15T12:00:00.000Z');

// Issue #611: aviso previo al cambio de precio contra Postgres real. Prueba la
// ventana de consulta por priceStartedAt y que repetir el escaneo no reenvíe.
describe('SubscriptionPriceNoticesService (integration, real Prisma)', () => {
  let prisma: PrismaService;
  let notifications: { create: jest.Mock };
  let mail: { sendSubscriptionReminderEmail: jest.Mock };
  let service: SubscriptionPriceNoticesService;
  const runId = Date.now();
  const userIds: string[] = [];

  const config = {
    get: (key: string) =>
      key === 'SUBSCRIPTIONS_ENFORCED' ? 'true' : undefined,
  } as unknown as ConfigService;

  const createSubscription = async (tag: string, priceStartedAt: Date) => {
    const user = await prisma.user.create({
      data: {
        email: `pn611-${tag}-${runId}@example.com`,
        passwordHash: 'not-a-real-hash',
        name: 'Dra. Aviso',
      },
    });
    userIds.push(user.id);
    return prisma.subscription.create({
      data: {
        userId: user.id,
        priceClp: 6990,
        priceStartedAt,
        currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY_MS),
      },
    });
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  }, 30000);

  beforeEach(() => {
    notifications = { create: jest.fn().mockResolvedValue({}) };
    mail = { sendSubscriptionReminderEmail: jest.fn() };
    service = new SubscriptionPriceNoticesService(
      prisma,
      config,
      new SubscriptionsService(prisma, config),
      notifications as unknown as NotificationsService,
      mail as unknown as MailService,
    );
  });

  afterAll(async () => {
    await prisma.subscriptionPriceNotice.deleteMany({
      where: { subscription: { userId: { in: userIds } } },
    });
    await prisma.subscription.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('avisa una sola vez a la cuenta cuyo precio cambia en menos de 30 días, y no a las demás', async () => {
    // El precio de esta cuenta cambia el 2027-11-10 (26 días después de NOW).
    const due = await createSubscription(
      'due',
      new Date('2026-11-10T12:00:00.000Z'),
    );
    // Cambia el 2027-12-20: faltan más de 30 días.
    await createSubscription('later', new Date('2026-12-20T12:00:00.000Z'));
    // Cambió el 2027-09-01: el precio ya subió.
    await createSubscription('past', new Date('2026-09-01T12:00:00.000Z'));

    await service.scan(NOW);
    await service.scan(NOW);

    const calls = notifications.create.mock.calls as [
      { userId: string; type: string },
    ][];
    const notified = calls.filter((call) => userIds.includes(call[0].userId));
    expect(notified).toHaveLength(1);
    expect(notified[0][0]).toMatchObject({
      userId: due.userId,
      type: 'SUBSCRIPTION_PRICE_CHANGE',
    });
    expect(mail.sendSubscriptionReminderEmail).toHaveBeenCalledTimes(1);
    const rows = await prisma.subscriptionPriceNotice.findMany({
      where: { subscription: { userId: { in: userIds } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].subscriptionId).toBe(due.id);
    expect(rows[0].priceChangeAt.toISOString()).toBe(
      '2027-11-10T12:00:00.000Z',
    );
  }, 30000);
});

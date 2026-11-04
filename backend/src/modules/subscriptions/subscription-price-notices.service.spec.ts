import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildPriceNoticeTexts,
  SubscriptionPriceNoticesService,
} from './subscription-price-notices.service';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-10-15T12:00:00.000Z');

describe('SubscriptionPriceNoticesService (issue #611)', () => {
  let prisma: {
    subscription: { findMany: jest.Mock };
    subscriptionPriceNotice: { create: jest.Mock; deleteMany: jest.Mock };
  };
  let subscriptions: {
    isEnforced: jest.Mock;
    getAccess: jest.Mock;
    priceChange: jest.Mock;
  };
  let notifications: { create: jest.Mock };
  let mail: { sendSubscriptionReminderEmail: jest.Mock };
  let service: SubscriptionPriceNoticesService;

  const changesAt = (daysLeft: number) =>
    new Date(NOW.getTime() + daysLeft * DAY_MS);
  const sub = {
    id: 'sub-1',
    userId: 'user-1',
    priceClp: 6990,
    priceStartedAt: new Date('2026-11-10T12:00:00.000Z'),
    user: { email: 'ana@mail.com', name: 'Ana' },
  };

  beforeEach(() => {
    prisma = {
      subscription: { findMany: jest.fn().mockResolvedValue([sub]) },
      subscriptionPriceNotice: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn(),
      },
    };
    subscriptions = {
      isEnforced: jest.fn().mockReturnValue(true),
      getAccess: jest.fn().mockResolvedValue({ state: 'ACTIVE' }),
      priceChange: jest.fn().mockReturnValue({
        changesAt: changesAt(26),
        fromPriceClp: 6990,
        toPriceClp: 12990,
      }),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    mail = { sendSubscriptionReminderEmail: jest.fn() };
    service = new SubscriptionPriceNoticesService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn((k: string) =>
          k === 'FRONTEND_URL' ? 'https://app.test/' : undefined,
        ),
      } as unknown as ConfigService,
      subscriptions as unknown as SubscriptionsService,
      notifications as unknown as NotificationsService,
      mail as unknown as MailService,
    );
  });

  it('con el interruptor apagado no consulta ni avisa', async () => {
    subscriptions.isEnforced.mockReturnValue(false);
    await service.scan(NOW);
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('a menos de 30 días del cambio envía notificación in-app y email, y reclama el aviso', async () => {
    await service.scan(NOW);
    expect(prisma.subscriptionPriceNotice.create).toHaveBeenCalledWith({
      data: { subscriptionId: 'sub-1', priceChangeAt: changesAt(26) },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'SUBSCRIPTION_PRICE_CHANGE',
        linkPath: '/suscripcion',
      }),
    );
    expect(mail.sendSubscriptionReminderEmail).toHaveBeenCalledWith(
      'ana@mail.com',
      'Ana',
      'Tu suscripción de Umbral cambiará de precio',
      expect.stringContaining('$12.990'),
      'https://app.test/suscripcion',
    );
  });

  it('el texto dice la fecha, el precio de hoy y el nuevo', () => {
    const { title, body } = buildPriceNoticeTexts(
      new Date('2027-11-10T12:00:00.000Z'),
      6990,
      12990,
    );
    expect(title).toBe('Tu suscripción de Umbral cambiará de precio');
    expect(body).toBe(
      'A partir del 10 de noviembre de 2027 tu suscripción pasa de $6.990 a $12.990 al mes. No tienes que hacer nada: el cambio aplica a los pagos desde esa fecha.',
    );
  });

  it('a más de 30 días del cambio no avisa todavía', async () => {
    subscriptions.priceChange.mockReturnValue({
      changesAt: changesAt(31),
      fromPriceClp: 6990,
      toPriceClp: 12990,
    });
    await service.scan(NOW);
    expect(prisma.subscriptionPriceNotice.create).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('si el cron no corrió y quedan pocos días, avisa igual una sola vez', async () => {
    subscriptions.priceChange.mockReturnValue({
      changesAt: changesAt(2),
      fromPriceClp: 6990,
      toPriceClp: 12990,
    });
    await service.scan(NOW);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('si el precio no sube o ya cambió, no avisa', async () => {
    subscriptions.priceChange.mockReturnValue(null);
    await service.scan(NOW);
    expect(prisma.subscriptionPriceNotice.create).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it.each(['EXEMPT', 'READ_ONLY'])(
    'no avisa a cuentas en estado %s',
    async (state) => {
      subscriptions.getAccess.mockResolvedValue({ state });
      await service.scan(NOW);
      expect(prisma.subscriptionPriceNotice.create).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    },
  );

  it.each(['ACTIVE', 'GRACE'])(
    'avisa a cuentas en estado %s',
    async (state) => {
      subscriptions.getAccess.mockResolvedValue({ state });
      await service.scan(NOW);
      expect(notifications.create).toHaveBeenCalledTimes(1);
    },
  );

  it('no reenvía un aviso ya reclamado (unique)', async () => {
    prisma.subscriptionPriceNotice.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await service.scan(NOW);
    expect(notifications.create).not.toHaveBeenCalled();
    expect(mail.sendSubscriptionReminderEmail).not.toHaveBeenCalled();
  });

  it('si falla la notificación libera el reclamo para reintentar y no envía email', async () => {
    notifications.create.mockRejectedValue(new Error('db caída'));
    await service.scan(NOW);
    expect(prisma.subscriptionPriceNotice.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'sub-1', priceChangeAt: changesAt(26) },
    });
    expect(mail.sendSubscriptionReminderEmail).not.toHaveBeenCalled();
  });

  it('un fallo en una cuenta no corta el lote', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      { ...sub, id: 'sub-0', userId: 'user-0' },
      sub,
    ]);
    notifications.create
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({});
    await service.scan(NOW);
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it('consulta solo suscripciones cuyo precio de lanzamiento termina en la ventana', async () => {
    await service.scan(NOW);
    const calls = prisma.subscription.findMany.mock.calls as [
      { where: { priceStartedAt: { gt: Date; lte: Date } } },
    ][];
    const arg = calls[0][0];
    // Ventana de priceStartedAt: hace 12 meses (menos 2 días de holgura) hasta
    // hace 12 meses más 30 días (más 2 días de holgura).
    expect(arg.where.priceStartedAt.gt.toISOString()).toBe(
      '2026-10-13T12:00:00.000Z',
    );
    expect(arg.where.priceStartedAt.lte.toISOString()).toBe(
      '2026-11-16T12:00:00.000Z',
    );
  });
});

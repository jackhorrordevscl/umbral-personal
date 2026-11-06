import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildReminderTexts,
  SubscriptionRemindersService,
} from './subscription-reminders.service';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-12-05T12:00:00.000Z');

describe('SubscriptionRemindersService', () => {
  let prisma: {
    subscription: { findMany: jest.Mock };
    subscriptionReminder: {
      createMany: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let subscriptions: { isEnforced: jest.Mock; getAccess: jest.Mock };
  let notifications: { create: jest.Mock };
  let mail: { sendSubscriptionReminderEmail: jest.Mock };
  let service: SubscriptionRemindersService;

  const sub = (daysLeft: number) => ({
    id: 'sub-1',
    userId: 'user-1',
    currentPeriodEnd: new Date(NOW.getTime() + daysLeft * DAY_MS),
    user: { email: 'ana@mail.com', name: 'Ana' },
  });

  beforeEach(() => {
    prisma = {
      subscription: { findMany: jest.fn().mockResolvedValue([sub(5)]) },
      subscriptionReminder: {
        createMany: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn(),
      },
    };
    subscriptions = {
      isEnforced: jest.fn().mockReturnValue(true),
      getAccess: jest.fn().mockResolvedValue({ state: 'ACTIVE' }),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    mail = { sendSubscriptionReminderEmail: jest.fn() };
    service = new SubscriptionRemindersService(
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

  it('a 5 días envía notificación in-app y email, y reclama el aviso', async () => {
    await service.scan(NOW);
    expect(prisma.subscriptionReminder.create).toHaveBeenCalledWith({
      data: {
        subscriptionId: 'sub-1',
        periodEnd: new Date(NOW.getTime() + 5 * DAY_MS),
        offsetDays: 5,
        sent: true,
      },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'SUBSCRIPTION_EXPIRING',
        linkPath: '/suscripcion',
      }),
    );
    expect(mail.sendSubscriptionReminderEmail).toHaveBeenCalledWith(
      'ana@mail.com',
      'Ana',
      expect.stringContaining('vence en 5 días'),
      expect.any(String),
      'https://app.test/suscripcion',
    );
  });

  it('si el cron no corrió, envía el más urgente y reclama los anteriores sin enviar', async () => {
    prisma.subscription.findMany.mockResolvedValue([sub(0.5)]);
    await service.scan(NOW);
    expect(prisma.subscriptionReminder.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ offsetDays: 5, sent: false })],
      skipDuplicates: true,
    });
    expect(prisma.subscriptionReminder.create).toHaveBeenCalledWith({
      data: {
        subscriptionId: 'sub-1',
        periodEnd: new Date(NOW.getTime() + 0.5 * DAY_MS),
        offsetDays: 1,
        sent: true,
      },
    });
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('no reenvía un aviso ya reclamado (unique)', async () => {
    prisma.subscriptionReminder.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await service.scan(NOW);
    expect(notifications.create).not.toHaveBeenCalled();
    expect(mail.sendSubscriptionReminderEmail).not.toHaveBeenCalled();
  });

  it.each(['EXEMPT', 'READ_ONLY'])(
    'no avisa a cuentas en estado %s',
    async (state) => {
      subscriptions.getAccess.mockResolvedValue({ state });
      await service.scan(NOW);
      expect(prisma.subscriptionReminder.create).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    },
  );

  it('si falla la notificación y también liberar el reclamo, el log conserva el error original (issue #633)', async () => {
    notifications.create.mockRejectedValue(new Error('db caída'));
    prisma.subscriptionReminder.deleteMany.mockRejectedValue(
      new Error('delete falló'),
    );
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await service.scan(NOW);
      const messages = errorLog.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('db caída'))).toBe(true);
      expect(messages.some((m) => m.includes('delete falló'))).toBe(true);
      expect(mail.sendSubscriptionReminderEmail).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('si falla la notificación libera el reclamo para reintentar y no envía email', async () => {
    notifications.create.mockRejectedValue(new Error('db caída'));
    await service.scan(NOW);
    expect(prisma.subscriptionReminder.deleteMany).toHaveBeenCalledWith({
      where: {
        subscriptionId: 'sub-1',
        periodEnd: new Date(NOW.getTime() + 5 * DAY_MS),
        offsetDays: 5,
      },
    });
    expect(mail.sendSubscriptionReminderEmail).not.toHaveBeenCalled();
  });

  it('un fallo en una cuenta no corta el lote', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      { ...sub(5), id: 'a', userId: 'ua' },
      { ...sub(5), id: 'b', userId: 'ub' },
    ]);
    subscriptions.getAccess
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ state: 'ACTIVE' });
    await service.scan(NOW);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });
});

describe('buildReminderTexts', () => {
  const end = new Date('2026-12-10T12:00:00.000Z');
  it('1 día dice "mañana"', () => {
    expect(buildReminderTexts(1, end).title).toContain('mañana');
  });
  it('0 días avisa que venció y menciona la gracia de 7 días', () => {
    const t = buildReminderTexts(0, end);
    expect(t.title).toContain('venció');
    expect(t.body).toContain('7 días de gracia');
  });
});

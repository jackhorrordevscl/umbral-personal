import { NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

function buildNotification(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: 'notification-1',
    userId: 'therapist-a',
    type: 'SESSION_REMINDER',
    title: 'Sesión próxima',
    body: 'Tienes una sesión en 24 horas',
    linkPath: null,
    metadata: null,
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as Notification;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('crea la notificación asociada al userId recibido', async () => {
      const created = buildNotification();
      prisma.notification.create.mockResolvedValue(created);

      const result = await service.create({
        userId: 'therapist-a',
        type: 'SESSION_REMINDER',
        title: 'Sesión próxima',
        body: 'Tienes una sesión en 24 horas',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'therapist-a',
          type: 'SESSION_REMINDER',
          title: 'Sesión próxima',
          body: 'Tienes una sesión en 24 horas',
          linkPath: undefined,
          metadata: undefined,
        },
      });
      expect(result).toBe(created);
    });
  });

  describe('list', () => {
    it('sin page/pageSize devuelve la lista completa scoped por userId', async () => {
      const notifications = [buildNotification()];
      prisma.notification.findMany.mockResolvedValue(notifications);

      const result = await service.list('therapist-a');

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'therapist-a' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(notifications);
    });

    it('con page/pageSize pagina con take/skip y devuelve el total', async () => {
      const notifications = [buildNotification()];
      prisma.notification.findMany.mockResolvedValue(notifications);
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.list('therapist-a', {
        page: 2,
        pageSize: 10,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'therapist-a' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 10,
      });
      expect(result).toEqual({
        data: notifications,
        total: 1,
        page: 2,
        pageSize: 10,
      });
    });
  });

  describe('unreadCount', () => {
    it('cuenta solo las notificaciones no leídas del userId', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.unreadCount('therapist-a');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'therapist-a', readAt: null },
      });
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('markRead', () => {
    // T3.1 (RED first): un terapeuta que no es dueño de la notificación no
    // puede marcarla leída -- el WHERE de updateMany incluye userId, así que
    // 0 filas afectadas para un id ajeno, nunca una escritura cruzada.
    it('un terapeuta que no es dueño recibe 404 y la notificación no cambia', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markRead('notification-1', 'therapist-b'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notification-1', userId: 'therapist-b' },
        data: { readAt: expect.any(Date) as unknown as Date },
      });
      // No debe intentar leer/devolver nada tras un updateMany que no afectó filas
      expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    });

    it('el dueño puede marcar su notificación como leída', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });
      const updated = buildNotification({ readAt: new Date() });
      prisma.notification.findFirst.mockResolvedValue(updated);

      const result = await service.markRead('notification-1', 'therapist-a');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notification-1', userId: 'therapist-a' },
        data: { readAt: expect.any(Date) as unknown as Date },
      });
      expect(result).toBe(updated);
    });
  });

  describe('markAllRead', () => {
    it('marca como leídas todas las notificaciones no leídas del userId', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllRead('therapist-a');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'therapist-a', readAt: null },
        data: { readAt: expect.any(Date) as unknown as Date },
      });
      expect(result).toEqual({ count: 5 });
    });
  });
});

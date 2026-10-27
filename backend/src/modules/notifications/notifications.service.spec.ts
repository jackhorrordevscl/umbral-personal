import { NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UNPAGINATED_SAFETY_LIMIT } from '../../common/dto/pagination.dto';
import { ClinicalTextCryptoService } from '../../common/crypto/clinical-text-crypto.service';
import { buildTestClinicalCrypto } from '../../common/crypto/clinical-text-crypto.testing';
import {
  notificationTextContext,
  UNREADABLE_NOTIFICATION_BODY,
  UNREADABLE_NOTIFICATION_TITLE,
} from './util/notification-text.util';

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
  let crypto: ClinicalTextCryptoService;
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

    crypto = buildTestClinicalCrypto();
    service = new NotificationsService(
      prisma as unknown as PrismaService,
      crypto,
    );
  });

  // Fila tal como queda en la base: title y body cifrados.
  function storedNotification(overrides: Partial<Notification> = {}) {
    const userId = overrides.userId ?? 'therapist-a';
    return buildNotification({
      title: crypto.encrypt(
        'Sesión próxima',
        notificationTextContext(userId, 'title'),
      ),
      body: crypto.encrypt(
        'Tu sesión con Juan Soto es en 24 horas',
        notificationTextContext(userId, 'body'),
      ),
      ...overrides,
    });
  }

  describe('create', () => {
    it('crea la notificación asociada al userId recibido', async () => {
      prisma.notification.create.mockImplementation(
        ({ data }: { data: Partial<Notification> }) =>
          Promise.resolve(buildNotification(data)),
      );

      await service.create({
        userId: 'therapist-a',
        type: 'SESSION_REMINDER',
        title: 'Sesión próxima',
        body: 'Tienes una sesión en 24 horas',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'therapist-a',
          type: 'SESSION_REMINDER',
          title: expect.any(String) as unknown as string,
          body: expect.any(String) as unknown as string,
          linkPath: undefined,
          metadata: undefined,
        },
      });
    });

    it('guarda title y body cifrados (sin el nombre del paciente en claro) y devuelve la notificación en claro', async () => {
      prisma.notification.create.mockImplementation(
        ({ data }: { data: Partial<Notification> }) =>
          Promise.resolve(buildNotification(data)),
      );

      const result = await service.create({
        userId: 'therapist-a',
        type: 'SESSION_REMINDER',
        title: 'Recordatorio de sesión en 24 horas',
        body: 'Tu sesión con Juan Soto está programada para mañana.',
      });

      const calls = prisma.notification.create.mock.calls as {
        data: { title: string; body: string };
      }[][];
      const stored = calls[0][0].data;
      expect(stored.title).toMatch(/^enc:v4:/);
      expect(stored.body).toMatch(/^enc:v4:/);
      expect(JSON.stringify(stored)).not.toContain('Juan Soto');
      // Ligado al usuario destinatario y al campo (issue #486).
      expect(
        crypto.decrypt(
          stored.body,
          notificationTextContext('therapist-a', 'body'),
        ),
      ).toBe('Tu sesión con Juan Soto está programada para mañana.');
      expect(() =>
        crypto.decrypt(
          stored.body,
          notificationTextContext('therapist-b', 'body'),
        ),
      ).toThrow();
      expect(result.title).toBe('Recordatorio de sesión en 24 horas');
      expect(result.body).toBe(
        'Tu sesión con Juan Soto está programada para mañana.',
      );
    });
  });

  describe('list', () => {
    it('sin page/pageSize devuelve la lista completa scoped por userId, con title y body en claro', async () => {
      prisma.notification.findMany.mockResolvedValue([storedNotification()]);

      const result = await service.list('therapist-a');

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'therapist-a' },
        orderBy: { createdAt: 'desc' },
        take: UNPAGINATED_SAFETY_LIMIT,
      });
      expect(result).toEqual([
        expect.objectContaining({
          id: 'notification-1',
          title: 'Sesión próxima',
          body: 'Tu sesión con Juan Soto es en 24 horas',
        }),
      ]);
    });

    it('las filas heredadas en texto plano se leen tal cual', async () => {
      prisma.notification.findMany.mockResolvedValue([buildNotification()]);

      const result = (await service.list('therapist-a')) as Notification[];

      expect(result[0].title).toBe('Sesión próxima');
      expect(result[0].body).toBe('Tienes una sesión en 24 horas');
    });

    it('una fila que no se puede descifrar muestra un texto neutro y no tumba al resto de la lista', async () => {
      // Cambia un carácter del medio del base64: la autenticación de GCM falla.
      const valid = crypto.encrypt(
        'Tu sesión con Ana Pérez',
        notificationTextContext('therapist-a', 'body'),
      );
      const at = valid.length - 8;
      const tampered = storedNotification({
        id: 'notification-bad',
        body: `${valid.slice(0, at)}${valid[at] === 'A' ? 'B' : 'A'}${valid.slice(at + 1)}`,
      });
      prisma.notification.findMany.mockResolvedValue([
        tampered,
        storedNotification({ id: 'notification-ok' }),
      ]);

      const result = (await service.list('therapist-a')) as Notification[];

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe(UNREADABLE_NOTIFICATION_TITLE);
      expect(result[0].body).toBe(UNREADABLE_NOTIFICATION_BODY);
      expect(JSON.stringify(result[0])).not.toContain('Ana Pérez');
      expect(result[1].body).toBe('Tu sesión con Juan Soto es en 24 horas');
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
      const readAt = new Date();
      prisma.notification.findFirst.mockResolvedValue(
        storedNotification({ readAt }),
      );

      const result = await service.markRead('notification-1', 'therapist-a');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notification-1', userId: 'therapist-a' },
        data: { readAt: expect.any(Date) as unknown as Date },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: 'notification-1',
          readAt,
          title: 'Sesión próxima',
          body: 'Tu sesión con Juan Soto es en 24 horas',
        }),
      );
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

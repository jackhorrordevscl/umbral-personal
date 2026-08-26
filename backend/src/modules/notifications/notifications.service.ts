import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// sdd/session-reminders PR 1: modelo genérico de notificaciones in-app,
// consumido en este PR solo por su propio CRUD dueño-scoped. `create` queda
// expuesto para que RemindersService (PR 2) y futuras fuentes (p. ej.
// google-calendar-sync) lo llamen directo, sin ruta HTTP propia -- por eso
// no hay CreateNotificationDto ni endpoint POST en el controller.
export interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  async create(data: CreateNotificationData) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        linkPath: data.linkPath,
        metadata: data.metadata,
      },
    });
    this.logger.log(
      `Notificación creada: id=${notification.id} userId=${data.userId} type=${data.type}`,
    );
    return notification;
  }

  // Sin page/pageSize devuelve la lista completa (mismo criterio
  // retrocompatible que PatientsService.findAll, issue #48); con ambos,
  // pagina con take/skip.
  async list(
    userId: string,
    pagination?: { page?: number; pageSize?: number },
  ) {
    const where = { userId };
    const { page, pageSize } = pagination ?? {};
    const isPaginated = !!page && !!pageSize;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(isPaginated ? { take: pageSize, skip: (page - 1) * pageSize } : {}),
      }),
      isPaginated
        ? this.prisma.notification.count({ where })
        : Promise.resolve(undefined),
    ]);

    return isPaginated ? { data, total, page, pageSize } : data;
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  // updateMany({ id, userId }) en vez de update({ id }) -- la condición de
  // ownership vive en el WHERE de la propia escritura, no en un findFirst
  // previo: 0 filas afectadas es indistinguible entre "no existe" y "existe
  // pero es de otro terapeuta", así que ambos casos devuelven 404 uniforme
  // (mismo patrón que PatientsService.assertAccess, issue #30: no revelar
  // vía 403 vs 404 que el recurso existe).
  async markRead(id: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Notificación no encontrada');
    }
    return this.prisma.notification.findFirst({ where: { id, userId } });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}

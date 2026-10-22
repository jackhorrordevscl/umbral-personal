import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

// Issue #290: la tabla Notification solo crecía y el listado sin paginar
// devolvía todas las filas del usuario. Se purgan las notificaciones ya LEÍDAS
// hace más de NOTIFICATIONS_PURGE_RETENTION_DAYS.
// Issue #501 (A4): las no leídas tampoco se conservan para siempre (pueden
// nombrar al paciente; minimización, Ley 21.719): se purgan a los
// NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS desde su creación.
export const NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS = 30;
export const NOTIFICATIONS_PURGE_DEFAULT_UNREAD_RETENTION_DAYS = 90;
export const NOTIFICATIONS_PURGE_BATCH_SIZE = 1000;
// Tope de seguridad por corrida (configurable con
// NOTIFICATIONS_PURGE_MAX_BATCHES). Si queda backlog, lo toma la corrida del
// día siguiente en vez de mantener la DB ocupada.
export const NOTIFICATIONS_PURGE_DEFAULT_MAX_BATCHES = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsPurgeService {
  private readonly logger = new Logger(NotificationsPurgeService.name);
  private readonly enabled: boolean;
  private readonly retentionMs: number;
  private readonly unreadRetentionMs: number;
  private readonly maxBatches: number;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    // Ausente => habilitado por default: solo un "false" explícito lo
    // desactiva (mismo criterio que SessionPurgeService).
    this.enabled =
      this.config.get<string>('NOTIFICATIONS_PURGE_ENABLED') !== 'false';
    this.retentionMs =
      this.readPositiveInt(
        'NOTIFICATIONS_PURGE_RETENTION_DAYS',
        NOTIFICATIONS_PURGE_DEFAULT_RETENTION_DAYS,
      ) * DAY_MS;
    this.unreadRetentionMs =
      this.readPositiveInt(
        'NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS',
        NOTIFICATIONS_PURGE_DEFAULT_UNREAD_RETENTION_DAYS,
      ) * DAY_MS;
    this.maxBatches = this.readPositiveInt(
      'NOTIFICATIONS_PURGE_MAX_BATCHES',
      NOTIFICATIONS_PURGE_DEFAULT_MAX_BATCHES,
    );

    if (!this.enabled) {
      this.logger.warn(
        'NOTIFICATIONS_PURGE_ENABLED="false": la purga de notificaciones queda deshabilitada.',
      );
    }
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  // 04:30 diario según la zona horaria del servidor (UTC en Render),
  // desfasado de la purga de sesiones (04:00). Nunca lanza: un fallo se
  // registra y la próxima corrida reintenta.
  @Cron('30 4 * * *')
  async purge(): Promise<void> {
    if (!this.enabled) return;

    if (this.running) {
      this.logger.warn(
        'Purga de notificaciones omitida: la corrida anterior sigue en curso.',
      );
      return;
    }

    this.running = true;
    try {
      const now = Date.now();
      const readCutoff = new Date(now - this.retentionMs);
      const unreadCutoff = new Date(now - this.unreadRetentionMs);
      let deleted = 0;

      for (let batch = 0; batch < this.maxBatches; batch++) {
        const rows = await this.prisma.notification.findMany({
          where: {
            OR: [
              { readAt: { lt: readCutoff } },
              { readAt: null, createdAt: { lt: unreadCutoff } },
            ],
          },
          select: { id: true },
          take: NOTIFICATIONS_PURGE_BATCH_SIZE,
        });
        if (rows.length === 0) break;

        const result = await this.prisma.notification.deleteMany({
          where: { id: { in: rows.map((row) => row.id) } },
        });
        deleted += result.count;

        if (rows.length < NOTIFICATIONS_PURGE_BATCH_SIZE) break;
      }

      this.logger.log(`Purga de notificaciones: ${deleted} filas eliminadas.`);
    } catch (err) {
      this.logger.error(
        `Purga de notificaciones falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}

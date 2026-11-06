import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GRACE_DAYS } from './access-state';
import {
  ReminderOffsetDays,
  REMINDER_OFFSETS_DAYS,
  resolveDueReminders,
} from './reminder-schedule';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_BATCH_LIMIT = 200;
const SUBSCRIPTION_PATH = '/suscripcion';

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Santiago',
  }).format(date);
}

export function buildReminderTexts(
  offsetDays: ReminderOffsetDays,
  periodEnd: Date,
): { title: string; body: string } {
  const end = formatDate(periodEnd);
  if (offsetDays === 0) {
    return {
      title: 'Tu suscripción de Umbral venció',
      body: `Tu suscripción venció el ${end}. Tienes ${GRACE_DAYS} días de gracia; después la cuenta pasará a solo lectura. Renueva para seguir registrando sesiones.`,
    };
  }
  const when = offsetDays === 1 ? 'mañana' : `en ${offsetDays} días`;
  return {
    title: `Tu suscripción de Umbral vence ${when}`,
    body: `Tu suscripción vence el ${end}. Renueva antes de esa fecha para no perder días ni el acceso de escritura.`,
  };
}

// Issue #611 (PR 4): avisos de vencimiento a los 5, 1 y 0 días, una sola vez
// por período (unique en SubscriptionReminder). Es una ayuda, no la fuente
// del acceso: el estado de la cuenta se calcula al leer desde
// currentPeriodEnd. Si el servicio durmió y el cron no corrió, el siguiente
// tick avisa solo el más urgente y reclama los anteriores sin enviarlos.
@Injectable()
export class SubscriptionRemindersService {
  private readonly logger = new Logger(SubscriptionRemindersService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly subscriptions: SubscriptionsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_NOON)
  async scan(now: Date = new Date()): Promise<void> {
    // Apagado el interruptor, la app se comporta como antes de la
    // suscripción: nadie debe recibir avisos de cobro.
    if (!this.subscriptions.isEnforced()) return;
    if (this.running) return;
    this.running = true;
    try {
      const maxOffset = Math.max(...REMINDER_OFFSETS_DAYS);
      let cursor: string | undefined;
      for (;;) {
        const batch = await this.prisma.subscription.findMany({
          where: {
            currentPeriodEnd: {
              gt: new Date(now.getTime() - GRACE_DAYS * DAY_MS),
              // +1 día: el aviso se decide por día calendario, así que un
              // vencimiento de la tarde del día 5 ya está en ventana al mediodía.
              lte: new Date(now.getTime() + (maxOffset + 1) * DAY_MS),
            },
          },
          select: {
            id: true,
            userId: true,
            currentPeriodEnd: true,
            user: { select: { email: true, name: true } },
          },
          orderBy: { id: 'asc' },
          take: SCAN_BATCH_LIMIT,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const subscription of batch) {
          try {
            await this.processSubscription(subscription, now);
          } catch (err) {
            this.logger.error(
              `Falló el aviso de suscripción para subscriptionId=${subscription.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        if (batch.length < SCAN_BATCH_LIMIT) break;
        cursor = batch[batch.length - 1].id;
      }
    } finally {
      this.running = false;
    }
  }

  private async processSubscription(
    subscription: {
      id: string;
      userId: string;
      currentPeriodEnd: Date | null;
      user: { email: string; name: string };
    },
    now: Date,
  ): Promise<void> {
    const periodEnd = subscription.currentPeriodEnd;
    if (!periodEnd) return;

    // Solo cuentas que pagan: las exentas no reciben avisos, y las de solo
    // lectura ya los recibieron (o los perdieron) y tienen el banner.
    const access = await this.subscriptions.getAccess(subscription.userId, now);
    if (access.state !== 'ACTIVE' && access.state !== 'GRACE') return;

    const { send, skip } = resolveDueReminders(now, periodEnd);
    if (send === null) return;

    if (skip.length > 0) {
      await this.prisma.subscriptionReminder.createMany({
        data: skip.map((offsetDays) => ({
          subscriptionId: subscription.id,
          periodEnd,
          offsetDays,
          sent: false,
        })),
        skipDuplicates: true,
      });
    }

    try {
      await this.prisma.subscriptionReminder.create({
        data: {
          subscriptionId: subscription.id,
          periodEnd,
          offsetDays: send,
          sent: true,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return;
      throw err;
    }

    const { title, body } = buildReminderTexts(send, periodEnd);
    try {
      await this.notifications.create({
        userId: subscription.userId,
        type: NotificationType.SUBSCRIPTION_EXPIRING,
        title,
        body,
        linkPath: SUBSCRIPTION_PATH,
        metadata: { offsetDays: send, periodEnd: periodEnd.toISOString() },
      });
    } catch (err) {
      // Sin la notificación el aviso no llegó: se libera el reclamo para que
      // el próximo tick lo reintente.
      // Issue #633: si liberar el reclamo también falla, se conserva el error
      // original (el que explica por qué no llegó el aviso).
      try {
        await this.prisma.subscriptionReminder.deleteMany({
          where: {
            subscriptionId: subscription.id,
            periodEnd,
            offsetDays: send,
          },
        });
      } catch (releaseErr) {
        this.logger.error(
          `No se pudo liberar el reclamo del aviso subscriptionId=${subscription.id} offsetDays=${send}: ${
            releaseErr instanceof Error
              ? releaseErr.message
              : String(releaseErr)
          }`,
        );
      }
      throw err;
    }

    const baseUrl = (this.config.get<string>('FRONTEND_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    await this.mail.sendSubscriptionReminderEmail(
      subscription.user.email,
      subscription.user.name,
      title,
      body,
      `${baseUrl}${SUBSCRIPTION_PATH}`,
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addUtcMonths, LAUNCH_PRICE_MONTHS } from './launch-price';
import { SubscriptionsService } from './subscriptions.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_BATCH_LIMIT = 200;
const SUBSCRIPTION_PATH = '/suscripcion';
// Se avisa desde 30 días antes del cambio de precio.
export const PRICE_NOTICE_DAYS = 30;
// Holgura (días) de la ventana de consulta; el filtro exacto se hace en código
// con priceChange, así que el recorte de fin de mes nunca deja a nadie fuera.
const WINDOW_SLACK_DAYS = 2;

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

function formatClp(amount: number): string {
  return `$${new Intl.NumberFormat('es-CL').format(amount)}`;
}

export function buildPriceNoticeTexts(
  changesAt: Date,
  fromPriceClp: number,
  toPriceClp: number,
): { title: string; body: string } {
  return {
    title: 'Tu suscripción de Umbral cambiará de precio',
    body: `A partir del ${formatDate(changesAt)} tu suscripción pasa de ${formatClp(fromPriceClp)} a ${formatClp(toPriceClp)} al mes. No tienes que hacer nada: el cambio aplica a los pagos desde esa fecha.`,
  };
}

// Issue #611: aviso único, 30 días antes de que termine el precio de
// lanzamiento (unique en SubscriptionPriceNotice). Es una ayuda, no la fuente
// del precio: el checkout lo calcula al cobrar. Si el cron no corrió, el
// siguiente tick avisa igual mientras el cambio siga pendiente.
@Injectable()
export class SubscriptionPriceNoticesService {
  private readonly logger = new Logger(SubscriptionPriceNoticesService.name);
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
    // Apagado el interruptor, nadie debe recibir avisos de cobro.
    if (!this.subscriptions.isEnforced()) return;
    if (this.running) return;
    this.running = true;
    try {
      // El precio cambia a los 12 meses de priceStartedAt: la ventana de
      // priceStartedAt es "hace 12 meses" hasta "hace 12 meses + 30 días".
      const slack = WINDOW_SLACK_DAYS * DAY_MS;
      const base = addUtcMonths(now, -LAUNCH_PRICE_MONTHS);
      const where = {
        priceStartedAt: {
          gt: new Date(base.getTime() - slack),
          lte: new Date(base.getTime() + PRICE_NOTICE_DAYS * DAY_MS + slack),
        },
      };
      let cursor: string | undefined;
      for (;;) {
        const batch = await this.prisma.subscription.findMany({
          where,
          select: {
            id: true,
            userId: true,
            priceClp: true,
            priceStartedAt: true,
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
              `Falló el aviso de cambio de precio para subscriptionId=${subscription.id}: ${err instanceof Error ? err.message : String(err)}`,
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
      priceClp: number;
      priceStartedAt: Date;
      user: { email: string; name: string };
    },
    now: Date,
  ): Promise<void> {
    const change = this.subscriptions.priceChange(subscription, now);
    if (!change) return;
    if (change.changesAt.getTime() - now.getTime() > PRICE_NOTICE_DAYS * DAY_MS)
      return;

    // Solo cuentas que pagan: las exentas no pagan y las de solo lectura ya
    // tienen el banner de pago.
    const access = await this.subscriptions.getAccess(subscription.userId, now);
    if (access.state !== 'ACTIVE' && access.state !== 'GRACE') return;

    try {
      await this.prisma.subscriptionPriceNotice.create({
        data: {
          subscriptionId: subscription.id,
          priceChangeAt: change.changesAt,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return;
      throw err;
    }

    const { title, body } = buildPriceNoticeTexts(
      change.changesAt,
      change.fromPriceClp,
      change.toPriceClp,
    );
    try {
      await this.notifications.create({
        userId: subscription.userId,
        type: NotificationType.SUBSCRIPTION_PRICE_CHANGE,
        title,
        body,
        linkPath: SUBSCRIPTION_PATH,
        metadata: {
          priceChangeAt: change.changesAt.toISOString(),
          fromPriceClp: change.fromPriceClp,
          toPriceClp: change.toPriceClp,
        },
      });
    } catch (err) {
      // Sin la notificación el aviso no llegó: se libera el reclamo para que
      // el próximo tick lo reintente.
      // Si liberar también falla, ese error no debe tapar el original.
      try {
        await this.prisma.subscriptionPriceNotice.deleteMany({
          where: {
            subscriptionId: subscription.id,
            priceChangeAt: change.changesAt,
          },
        });
      } catch (releaseErr) {
        this.logger.error(
          `No se pudo liberar el reclamo del aviso de precio para subscriptionId=${subscription.id}: ${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
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

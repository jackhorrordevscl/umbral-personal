import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashInvitationCode } from '../auth/invitation-code.util';
import {
  AccessResult,
  PERIOD_DAYS,
  extendPeriod,
  resolveAccessState,
} from './access-state';

export const DEFAULT_SUBSCRIPTION_PRICE_CLP = 6990;
export const PROMO_CODE_INVALID = 'Código promocional inválido o vencido';

export function normalizeGrantEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // El precio vigente va en configuración; cada suscripción congela el suyo.
  private currentPriceClp(): number {
    const raw = Number(this.config.get<string>('SUBSCRIPTION_PRICE_CLP'));
    return Number.isInteger(raw) && raw > 0
      ? raw
      : DEFAULT_SUBSCRIPTION_PRICE_CLP;
  }

  // Issue #611: interruptor de despliegue. Apagado, la app se comporta como
  // antes de la suscripción (registro con invitación, sin bloqueos ni cobros).
  isEnforced(): boolean {
    return this.config.get<string>('SUBSCRIPTIONS_ENFORCED') === 'true';
  }

  // Cuenta que hoy no puede escribir: interruptor encendido y en solo lectura.
  // La gracia y el período activo sí escriben.
  async isWriteBlocked(
    userId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!this.isEnforced()) return false;
    return (await this.getAccess(userId, now)).state === 'READ_ONLY';
  }

  async getStatusView(userId: string, now: Date = new Date()) {
    const [access, subscription] = await Promise.all([
      this.getAccess(userId, now),
      this.prisma.subscription.findUnique({
        where: { userId },
        select: { priceClp: true },
      }),
    ]);
    return {
      enforced: this.isEnforced(),
      state: access.state,
      periodEnd: access.periodEnd,
      graceEnd: access.graceEnd,
      priceClp: subscription?.priceClp ?? this.currentPriceClp(),
    };
  }

  // Validación previa y de solo lectura del código promocional (no consume
  // cupo): el signup la corre ANTES de mirar si el email existe, para que un
  // código inválido no sirva de oráculo de qué emails tienen cuenta.
  async assertPromoCodeUsable(
    code: string,
    now: Date = new Date(),
  ): Promise<void> {
    const promo = await this.prisma.promoCode.findUnique({
      where: { codeHash: hashInvitationCode(code) },
    });
    if (
      !promo ||
      promo.expiresAt <= now ||
      promo.redemptionCount >= promo.maxRedemptions
    ) {
      throw new BadRequestException(PROMO_CODE_INVALID);
    }
  }

  // Crea la suscripción de la cuenta si aún no existe, congelando el precio
  // vigente; si ya existe la devuelve sin tocarla.
  async ensureSubscription(userId: string, now: Date = new Date()) {
    return this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        priceClp: this.currentPriceClp(),
        priceStartedAt: now,
      },
      update: {},
    });
  }

  async getAccess(
    userId: string,
    now: Date = new Date(),
  ): Promise<AccessResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        subscription: { select: { currentPeriodEnd: true } },
      },
    });
    if (!user)
      return resolveAccessState({ now, currentPeriodEnd: null, grant: null });
    const grant = await this.prisma.subscriptionGrant.findUnique({
      where: { email: normalizeGrantEmail(user.email) },
      select: { expiresAt: true },
    });
    return resolveAccessState({
      now,
      currentPeriodEnd: user.subscription?.currentPeriodEnd ?? null,
      grant,
    });
  }

  /**
   * Suma un período pagado. Idempotente por commerceOrder/flowOrder: un
   * webhook repetido no vuelve a sumar. Quien llama ya confirmó el pago con
   * getStatus de Flow (nunca por la respuesta de creación). Devuelve el nuevo
   * vencimiento, o null si el pago ya estaba aplicado.
   */
  async applyPaidPeriod(
    commerceOrder: string,
    flowOrder: number,
    now: Date = new Date(),
  ): Promise<Date | null> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({
        where: { commerceOrder },
      });
      if (!payment)
        throw new BadRequestException('Pago de suscripción desconocido');

      // Bloquea la suscripción: dos pagos simultáneos no pueden leer el mismo
      // vencimiento y pisarse.
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${payment.subscriptionId} FOR NO KEY UPDATE`;

      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id: payment.id, status: { not: 'PAID' } },
        data: { status: 'PAID', flowOrder, paidAt: now },
      });
      if (claimed.count === 0) return null;

      const subscription = await tx.subscription.findUniqueOrThrow({
        where: { id: payment.subscriptionId },
      });
      const periodEnd = extendPeriod(
        now,
        subscription.currentPeriodEnd,
        PERIOD_DAYS,
      );
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { currentPeriodEnd: periodEnd },
      });
      return periodEnd;
    });
  }

  /**
   * Canje de código compartido: suma sus días de prueba. Se ejecuta dentro de
   * la transacción de signup (tx) para que el canje y la cuenta sean atómicos.
   * El tope se aplica con un incremento condicional: dos canjes simultáneos del
   * último cupo no pueden pasar ambos.
   */
  async redeemPromoCode(
    tx: Prisma.TransactionClient,
    userId: string,
    code: string,
    now: Date = new Date(),
  ): Promise<Date> {
    const promo = await tx.promoCode.findUnique({
      where: { codeHash: hashInvitationCode(code) },
    });
    if (!promo || promo.expiresAt <= now) {
      throw new BadRequestException(PROMO_CODE_INVALID);
    }
    const taken = await tx.promoCode.updateMany({
      where: { id: promo.id, redemptionCount: { lt: promo.maxRedemptions } },
      data: { redemptionCount: { increment: 1 } },
    });
    if (taken.count === 0) {
      throw new BadRequestException(PROMO_CODE_INVALID);
    }
    // userId es único: una cuenta canjea una sola vez (P2002 revierte el tx).
    await tx.promoRedemption.create({
      data: { promoCodeId: promo.id, userId },
    });

    const periodEnd = extendPeriod(now, null, promo.trialDays);
    await tx.subscription.upsert({
      where: { userId },
      create: {
        userId,
        currentPeriodEnd: periodEnd,
        priceClp: this.currentPriceClp(),
        priceStartedAt: now,
      },
      update: { currentPeriodEnd: periodEnd },
    });
    return periodEnd;
  }
}

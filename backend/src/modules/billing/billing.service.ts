import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowPaymentGatewayClient } from '../payments/flow-gateway.client';
import { GatewayCredentials } from '../payments/payment-gateway.client';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PERIOD_DAYS } from '../subscriptions/access-state';

const DEFAULT_BACKEND_URL = 'http://localhost:3001';
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

export const BILLING_CONFIRM_PATH = '/api/v1/billing/confirm';
export const BILLING_RETURN_PATH = '/api/v1/billing/return';
// Ruta del frontend a la que vuelve el navegador tras pagar (la pantalla se
// construye en el PR 3).
export const BILLING_FRONTEND_RETURN_PATH = '/suscripcion/retorno';

// Barrido de respaldo: un webhook perdido no deja a la cuenta sin acceso.
const SWEEP_MIN_AGE_MS = 15 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const SWEEP_BATCH_LIMIT = 200;

export type ConfirmOutcome =
  | 'unknown'
  | 'applied'
  | 'already_applied'
  | 'pending'
  | 'failed'
  | 'anomaly';

// Issue #611 (PR 2): cobro de la suscripción con Flow usando credenciales
// PROPIAS de la plataforma (variables de entorno), no las cifradas de cada
// terapeuta (PaymentAccount). El acceso se concede solo cuando getStatus de
// Flow confirma el pago, nunca por la respuesta de creación ni por el
// webhook en sí.
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flow: FlowPaymentGatewayClient,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private platformCredentials(): GatewayCredentials | null {
    const apiKey = this.config.get<string>('SUBSCRIPTION_FLOW_API_KEY');
    const secretKey = this.config.get<string>('SUBSCRIPTION_FLOW_SECRET_KEY');
    if (!apiKey || !secretKey) return null;
    return new GatewayCredentials(apiKey, secretKey);
  }

  async createCheckout(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ paymentUrl: string }> {
    const credentials = this.platformCredentials();
    if (!credentials) {
      this.logger.error(
        'Cobro de suscripción no disponible: faltan SUBSCRIPTION_FLOW_API_KEY / SUBSCRIPTION_FLOW_SECRET_KEY.',
      );
      throw new ServiceUnavailableException(
        'El pago de la suscripción no está disponible por ahora.',
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const subscription = await this.subscriptions.ensureSubscription(
      userId,
      now,
    );
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        commerceOrder: `sub-${randomUUID()}`,
        amountClp: subscription.priceClp,
      },
    });

    const backendUrl =
      this.config.get<string>('BACKEND_PUBLIC_URL') ?? DEFAULT_BACKEND_URL;
    try {
      const order = await this.flow.createOrder(credentials, {
        amount: payment.amountClp,
        currency: 'CLP',
        subject: `Suscripción Umbral (${PERIOD_DAYS} días)`,
        externalId: payment.commerceOrder,
        payerEmail: user.email,
        returnUrl: `${backendUrl}${BILLING_RETURN_PATH}`,
        confirmUrl: `${backendUrl}${BILLING_CONFIRM_PATH}`,
      });
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: { flowToken: order.token },
      });
      return { paymentUrl: order.paymentUrl };
    } catch (err) {
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: { status: 'FAILED' },
      });
      this.logger.error(
        `No se pudo crear la orden de suscripción (paymentId=${payment.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'No pudimos iniciar el pago. Intenta de nuevo en unos minutos.',
      );
    }
  }

  /**
   * Verifica el token con getStatus de Flow y, si está pagado por el monto
   * cobrado, suma el período (idempotente). Lanza si Flow no puede consultarse.
   */
  async confirmByToken(
    token: string,
    now: Date = new Date(),
  ): Promise<ConfirmOutcome> {
    const credentials = this.platformCredentials();
    if (!credentials) return 'unknown';
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { flowToken: token },
    });
    if (!payment) return 'unknown';
    if (payment.status === 'PAID') return 'already_applied';

    const order = await this.flow.getOrderStatus(credentials, token);
    if (order.status === 'PENDING') return 'pending';
    if (order.status === 'REJECTED') {
      await this.prisma.subscriptionPayment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      return 'failed';
    }

    const flowOrder = Number(order.gatewayPaymentId);
    if (order.amount !== payment.amountClp || !Number.isInteger(flowOrder)) {
      this.logger.error(
        `Pago de suscripción pagado en Flow con datos inconsistentes; no se concede acceso (paymentId=${payment.id}, esperado=${payment.amountClp}, recibido=${order.amount}).`,
      );
      return 'anomaly';
    }
    const periodEnd = await this.subscriptions.applyPaidPeriod(
      payment.commerceOrder,
      flowOrder,
      now,
    );
    return periodEnd ? 'applied' : 'already_applied';
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(now: Date = new Date()): Promise<void> {
    if (!this.platformCredentials() || this.sweeping) return;
    this.sweeping = true;
    try {
      const candidates = await this.prisma.subscriptionPayment.findMany({
        where: {
          status: 'PENDING',
          flowToken: { not: null },
          createdAt: {
            gte: new Date(now.getTime() - SWEEP_MAX_AGE_MS),
            lte: new Date(now.getTime() - SWEEP_MIN_AGE_MS),
          },
        },
        select: { flowToken: true },
        orderBy: { createdAt: 'asc' },
        take: SWEEP_BATCH_LIMIT,
      });
      for (const { flowToken } of candidates) {
        if (!flowToken) continue;
        try {
          await this.confirmByToken(flowToken, now);
        } catch (err) {
          this.logger.warn(
            `Barrido de suscripciones: no se pudo verificar un pago: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  frontendReturnUrl(): string {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL;
    return `${frontendUrl}${BILLING_FRONTEND_RETURN_PATH}`;
  }
}

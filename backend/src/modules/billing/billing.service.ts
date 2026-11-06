import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowPaymentGatewayClient } from '../payments/flow-gateway.client';
import {
  GatewayCredentials,
  PaymentGatewayError,
} from '../payments/payment-gateway.client';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PERIOD_DAYS } from '../subscriptions/access-state';
import { isRenewalOpen } from '../subscriptions/renewal-window';

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
// Tope de checkouts abiertos por cuenta: una cuenta que abandona pagos no puede
// llenar el lote del barrido ni gastar llamadas a Flow con la clave de la
// plataforma. Solo cuentan los de la ventana del barrido.
const MAX_OPEN_CHECKOUTS = 5;
// Issue #633: sin timeout, Flow deja la orden pagable para siempre. Con él, una
// orden abandonada vence sola a las 24 h y el tope solo cuenta las de esa
// ventana: nadie queda bloqueado días. El barrido sigue mirando 3 días, así que
// un pago hecho justo antes de vencer y con webhook perdido igual se acredita.
const CHECKOUT_TIMEOUT_SECONDS = 24 * 60 * 60;
const CHECKOUT_TIMEOUT_MS = CHECKOUT_TIMEOUT_SECONDS * 1000;
// Flow responde 400 con code 1620 ("The userEmail: ... is not valid.") cuando no
// acepta el correo del pagador. Verificado en el sandbox el 3 nov 2026 con
// dominio inexistente, formato inválido y correo vacío. Reintentar no lo arregla.
const FLOW_INVALID_EMAIL_CODE = 1620;
// Consulta al volver de Flow: por cuenta, como mucho una vez cada 5 s (la
// pantalla de retorno consulta cada 5 s) y sobre los pagos pendientes más
// recientes. El mapa vive en memoria de la instancia: es solo un freno de
// costo, no una garantía; la seguridad la da confirmByToken.
const REFRESH_MIN_INTERVAL_MS = 4000;
const REFRESH_MAX_PAYMENTS = 3;
const REFRESH_CACHE_MAX_ENTRIES = 1000;

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
  private readonly lastRefreshAt = new Map<string, number>();

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
    // Issue #633: el frontend esconde el botón, pero la API debe negarse sola.
    // Antes de crear nada: ni suscripción (congela priceStartedAt) ni cobro.
    if (!this.subscriptions.isEnforced()) {
      throw new ForbiddenException(
        'El cobro de la suscripción no está activo.',
      );
    }
    const access = await this.subscriptions.getAccess(userId, now);
    if (access.state === 'EXEMPT') {
      throw new ForbiddenException(
        'Tu cuenta está exenta del pago de la suscripción.',
      );
    }
    // Issue #633: con la suscripción vigente solo se renueva en los últimos
    // días del período; en gracia o solo lectura se puede pagar siempre.
    if (
      access.state === 'ACTIVE' &&
      access.periodEnd &&
      !isRenewalOpen(now, access.periodEnd)
    ) {
      throw new ForbiddenException(
        'Tu suscripción está vigente. Podrás renovarla desde 5 días antes de su vencimiento.',
      );
    }

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
    const openCheckouts = await this.prisma.subscriptionPayment.count({
      where: {
        subscriptionId: subscription.id,
        status: 'PENDING',
        createdAt: { gte: new Date(now.getTime() - CHECKOUT_TIMEOUT_MS) },
      },
    });
    if (openCheckouts >= MAX_OPEN_CHECKOUTS) {
      throw new HttpException(
        'Tienes varios pagos iniciados sin completar. Termina uno o espera hasta 24 horas antes de intentar de nuevo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        commerceOrder: `sub-${randomUUID()}`,
        amountClp: this.subscriptions.effectivePriceClp(subscription, now),
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
        timeoutSeconds: CHECKOUT_TIMEOUT_SECONDS,
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
      if (
        err instanceof PaymentGatewayError &&
        err.kind === 'rejected' &&
        err.gatewayCode === FLOW_INVALID_EMAIL_CODE
      ) {
        throw new UnprocessableEntityException(
          'El procesador de pagos no aceptó el correo de tu cuenta. Revisa que sea un correo válido en tu perfil e intenta de nuevo.',
        );
      }
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
        // Los más recientes primero: un backlog de abandonados no desplaza a un
        // pago real cuyo webhook se perdió.
        orderBy: { createdAt: 'desc' },
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

  getStatus(userId: string) {
    return this.subscriptions.getStatusView(userId);
  }

  /**
   * Al volver de Flow no se espera el webhook (puede perderse o llegar tarde,
   * y el barrido solo mira pagos de más de 15 min): se consulta a Flow por los
   * pagos recientes de ESTA cuenta con confirmByToken, que verifica con
   * getStatus y es idempotente. Un fallo de Flow no se propaga: el estado
   * queda como estaba y el webhook o el barrido lo resuelven después. Un
   * error de base de datos en la consulta de pagos sí se propaga. Un
   * intervalo mínimo por cuenta acota las llamadas a Flow con la clave de la
   * plataforma.
   */
  async refreshPendingPayments(userId: string, now: Date = new Date()) {
    const last = this.lastRefreshAt.get(userId);
    if (last !== undefined && now.getTime() - last < REFRESH_MIN_INTERVAL_MS) {
      return this.getStatus(userId);
    }
    this.rememberRefresh(userId, now);

    const pending = await this.prisma.subscriptionPayment.findMany({
      where: {
        status: 'PENDING',
        flowToken: { not: null },
        subscription: { userId },
        createdAt: { gte: new Date(now.getTime() - SWEEP_MAX_AGE_MS) },
      },
      select: { flowToken: true },
      orderBy: { createdAt: 'desc' },
      take: REFRESH_MAX_PAYMENTS,
    });
    for (const { flowToken } of pending) {
      if (!flowToken) continue;
      try {
        await this.confirmByToken(flowToken, now);
      } catch (err) {
        this.logger.warn(
          `Consulta al volver de Flow: no se pudo verificar un pago: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return this.getStatus(userId);
  }

  private rememberRefresh(userId: string, now: Date): void {
    // Se borra antes de insertar para que el orden del Map sea el de la última
    // consulta; así, si el tope se alcanza, lo primero del Map es lo más viejo.
    this.lastRefreshAt.delete(userId);
    if (this.lastRefreshAt.size >= REFRESH_CACHE_MAX_ENTRIES) {
      const cutoff = now.getTime() - REFRESH_MIN_INTERVAL_MS;
      for (const [key, at] of this.lastRefreshAt) {
        if (at < cutoff) this.lastRefreshAt.delete(key);
      }
      // Si todas son recientes la poda no libera nada: se descartan las más
      // viejas hasta respetar el tope.
      for (const key of this.lastRefreshAt.keys()) {
        if (this.lastRefreshAt.size < REFRESH_CACHE_MAX_ENTRIES) break;
        this.lastRefreshAt.delete(key);
      }
    }
    this.lastRefreshAt.set(userId, now.getTime());
  }

  frontendReturnUrl(): string {
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? DEFAULT_FRONTEND_URL;
    return `${frontendUrl}${BILLING_FRONTEND_RETURN_PATH}`;
  }
}

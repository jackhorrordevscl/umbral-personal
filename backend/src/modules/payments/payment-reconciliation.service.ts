import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Payment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GatewayContext } from './payment-gateway.client';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { PaymentAccountService } from './payment-account.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from './payments.service';
import {
  CANCELLABLE_STATUSES,
  RECONCILE_MIN_AGE_MS,
  SWEEP_BATCH_LIMIT,
  SWEEP_CONCURRENCY,
} from './payments.constants';

// issue #137: extraído de PaymentsService -- ese servicio mezclaba el
// lifecycle transaccional de un cobro puntual (ensureCharge/updateAmount/
// resendPaymentLink/confirm/cancelUnpaid, etc.) con el cron de
// reconciliación periódica (sweep() cada 30 min). Misma separación de
// responsabilidades que la extracción de MfaService desde AuthService
// (issue #136): refactor puro, sin cambio de comportamiento -- mismos logs,
// mismo batching, misma concurrencia. markPaid() se queda en PaymentsService
// (lo usa también confirm()) y se invoca acá vía inyección.
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private paymentAccountService: PaymentAccountService,
    private gatewayRegistry: PaymentGatewayRegistry,
    private config: ConfigService,
    private mailService: MailService,
    private notificationsService: NotificationsService,
    private paymentsService: PaymentsService,
  ) {
    // Absent => enabled by default, same criterion as
    // RemindersService/CalendarSyncService -- only an explicit "false"
    // disables charge creation.
    this.enabled = this.config.get<string>('PAYMENTS_ENABLED') !== 'false';

    // T3.10: same degradation criterion as MailService without
    // RESEND_API_KEY -- the module still registers and starts, without
    // breaking the app's boot or the tests.
    if (!this.enabled) {
      this.logger.warn(
        'PAYMENTS_ENABLED="false": el flujo de cobro en línea queda deshabilitado (no se crean cargos, no se envían emails, no se procesan callbacks).',
      );
    }
  }

  // T6.1-6.2 + design.md "Data Flow": same shape as
  // CalendarSyncService.reconcile -- two independent passes.
  // @nestjs/schedule's EVERY_30_MINUTES covers exactly the cadence from
  // design.md ("@Cron(EVERY_30_MINUTES) sweep()"). design.md Decision 2:
  // the gateway context each candidate needs is resolved per payment and
  // memoized in a Map local to this one run (keyed by therapistId), so two
  // pending charges owned by the same therapist in the same sweep tick only
  // decrypt once -- the map is discarded when sweep() returns, no
  // long-lived plaintext cache.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled) return;

    const contextCache = new Map<string, Promise<GatewayContext | null>>();
    await this.transitionLatePayments();
    await this.reconcilePendingPayments(contextCache);
  }

  // T8.4 + design.md "Data Flow": unlike PR 2 (bulk updateMany, no
  // notifications), this PR needs to know WHICH rows won the transition to
  // fire the email + notification exactly once per charge -- same
  // bounded-concurrency batch shape (runInBatches, issue #115) as
  // reconcilePendingPayments/reconcileOne. Batched to SWEEP_BATCH_LIMIT for
  // the same reason as pass 2 (row cap per cron run). This pass never calls
  // the gateway, so it needs no gateway context at all.
  private async transitionLatePayments(): Promise<void> {
    const candidates = await this.prisma.payment.findMany({
      where: { status: 'PENDING', dueDate: { lte: new Date() } },
      take: SWEEP_BATCH_LIMIT,
    });

    await this.runInBatches(candidates, (payment) =>
      this.transitionOneToLate(payment).catch((err: unknown) => {
        this.logger.error(
          `Sweep: fallo al transicionar a LATE paymentId=${payment.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }),
    );
  }

  // design.md "PENDING -> LATE is a stored transition, not computed" + "The
  // Payment row IS the claim -- no ReminderDispatch-style table needed":
  // the same count-gated updateMany as the rest of the module (id + status:
  // 'PENDING' in the WHERE) decides who "wins" the transition -- 1 row
  // affected fires exactly one email + one in-app notification (spec.md
  // "One-Shot Late-Payment Notification"); 0 rows (already transitioned by
  // another tick/instance, or the charge was paid/cancelled between the
  // findMany and this update) is a silent no-op, WITHOUT notifying again
  // (T10.3: "a second tick emits none"). lateNotifiedAt is persisted in the
  // same write that wins the race -- "already transitioned" and "already
  // notified" are the same atomic fact.
  private async transitionOneToLate(payment: Payment): Promise<void> {
    const result = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'LATE', lateNotifiedAt: new Date() },
    });
    if (result.count === 0) return;

    const patient = await this.prisma.patient.findUnique({
      where: { id: payment.patientId },
      select: { email: true, fullName: true },
    });
    if (!patient) return;

    if (patient.email) {
      await this.mailService.sendLatePaymentEmail(
        patient.email,
        patient.fullName,
        payment.amount,
        payment.dueDate,
      );
    }

    await this.notificationsService.create({
      userId: payment.therapistId,
      type: NotificationType.PAYMENT_LATE,
      title: 'Cobro vencido',
      body: `El cobro de la sesión con ${patient.fullName} venció sin pago.`,
      linkPath: `/consultations?patientId=${payment.patientId}`,
    });
  }

  // T6.2: reconciliation of missed callbacks -- candidates whose token was
  // issued more than RECONCILE_MIN_AGE_MS ago, batched to
  // SWEEP_BATCH_LIMIT per run (same bounded-reconcile pattern as
  // CalendarSyncService.repairFailedLinks/backfill). Each candidate requires
  // one network call to Flow (gateway.getOrderStatus) -- runInBatches
  // (issue #115) runs up to SWEEP_CONCURRENCY of those concurrently, and an
  // isolated failure (per-item .catch below) never aborts the rest of the
  // batch.
  private async reconcilePendingPayments(
    contextCache: Map<string, Promise<GatewayContext | null>>,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MS);
    const candidates = await this.prisma.payment.findMany({
      where: {
        status: { in: [...CANCELLABLE_STATUSES] },
        gatewayToken: { not: null },
        orderIssuedAt: { lte: cutoff },
      },
      take: SWEEP_BATCH_LIMIT,
    });

    await this.runInBatches(candidates, (payment) =>
      this.reconcileOne(payment, contextCache).catch((err: unknown) => {
        this.logger.error(
          `Sweep: fallo al reconciliar paymentId=${payment.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }),
    );
  }

  // issue #115: transitionLatePayments()/reconcilePendingPayments() ran
  // their candidates fully sequentially, one DB/mail write or Flow round
  // trip at a time -- with up to SWEEP_BATCH_LIMIT (200) candidates, that
  // serializes the cron's duration on gateway latency. Per-item failure
  // isolation already comes from each candidate's own .catch (passed in by
  // the caller, never rejects here), not from running one at a time, so a
  // bounded worker pool is safe: SWEEP_CONCURRENCY candidates processed
  // concurrently per chunk, chunks run one after another.
  private async runInBatches<T>(
    items: T[],
    handler: (item: T) => Promise<void>,
  ): Promise<void> {
    for (let i = 0; i < items.length; i += SWEEP_CONCURRENCY) {
      const chunk = items.slice(i, i + SWEEP_CONCURRENCY);
      await Promise.all(chunk.map((item) => handler(item)));
    }
  }

  // design.md Decision 2: resolves through the run-scoped memo cache
  // instead of calling PaymentAccountService.resolveGatewayContext (which
  // decrypts) on every candidate -- an account with several stale charges
  // in the same sweep tick is decrypted at most once.
  //
  // The cache stores the in-flight Promise itself, not the awaited value --
  // set() runs synchronously before this function's own await, so a second
  // concurrent caller for the same therapistId (cancelUnpaidForPatient
  // dispatches cancelPaymentRow for every row via Promise.allSettled, all
  // starting before any of them awaits) sees the cache entry already
  // present and reuses that same promise instead of racing past the check
  // and triggering its own resolveGatewayContext call.
  //
  // issue #137: copia propia (no compartida con PaymentsService) -- cada
  // servicio necesita su propio cache Map por invocación, y compartir el
  // helper acoplaría innecesariamente los dos servicios.
  private resolveContextMemoized(
    therapistId: string,
    cache: Map<string, Promise<GatewayContext | null>>,
  ): Promise<GatewayContext | null> {
    if (!cache.has(therapistId)) {
      cache.set(
        therapistId,
        this.paymentAccountService.resolveGatewayContext(therapistId),
      );
    }
    return cache.get(therapistId)!;
  }

  private async reconcileOne(
    payment: Payment,
    contextCache: Map<string, Promise<GatewayContext | null>>,
  ): Promise<void> {
    if (!payment.gatewayToken) return;

    const context = await this.resolveContextMemoized(
      payment.therapistId,
      contextCache,
    );
    if (!context) return;

    const orderStatus = await this.gatewayRegistry
      .get(context.provider)
      .getOrderStatus(context.credentials, payment.gatewayToken);
    if (orderStatus.status !== 'PAID') return;

    await this.paymentsService.markPaid(
      payment.id,
      orderStatus.gatewayPaymentId,
    );
  }
}
